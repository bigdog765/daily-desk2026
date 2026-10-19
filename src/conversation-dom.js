import TurndownService from 'turndown';
import {gfm} from 'turndown-plugin-gfm';

// Packaged code injected into the extension's isolated world for each request.
// Keep all layout knowledge in one place so reading and sending agree on turns.
(() => {
  const visible=node=>!!node&&!!node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
  const unique=nodes=>[...new Set(nodes)].filter(node=>!nodes.some(other=>other!==node&&other.contains(node)));
  const selectors=role=>[
    `[data-message-author-role="${role}"]`,
    `[data-turn="${role}"]`,
    `[data-author="${role}"],[data-role="${role}"]`,
    `[data-message-role="${role}"],[data-message-author="${role}"]`,
    role==='assistant'?'article[aria-label^="ChatGPT said"],section[aria-label^="ChatGPT said"]':'article[aria-label^="You said"],section[aria-label^="You said"]'
  ];
  function messages(role){
    const regions=[...document.querySelectorAll('[role="region"][aria-label="Conversation"]')].filter(visible);
    if(regions.length>1)return [];
    const scope=regions[0]||document;
    for(const selector of selectors(role)){
      const found=unique([...scope.querySelectorAll(selector)]);
      if(found.length)return found;
    }
    if(regions.length===1){
      if(role==='user')return [...scope.querySelectorAll('[data-user-message-bubble]')];
      return [...scope.querySelectorAll('[data-markdown-text-style]')].filter(node=>node.closest('[data-chatgpt-selection-conversation-id]')&&!node.closest('[data-user-message-bubble],[class~="group/user-message"]'));
    }
    return [];
  }
  function editor(){
    const candidates=[...document.querySelectorAll('textarea,[contenteditable="true"],[contenteditable="plaintext-only"]')].filter(node=>visible(node)&&!node.disabled&&!node.closest('[data-message-author-role],[data-turn]'));
    const known=candidates.filter(node=>node.id==='prompt-textarea'||node.getAttribute('data-testid')==='prompt-textarea');
    function compatible(node){
      // The installed send routine recognizes ChatGPT's older test ID. Adapt
      // the new, explicitly labelled Send control inside this composer only.
      // This changes no text, clicks nothing, and never labels approval buttons.
      const composer=node.closest('[data-composer-body],form');
      if(composer){
        const sends=[...composer.querySelectorAll('button[aria-label="Send"]')].filter(visible);
        if(sends.length===1&&!sends[0].hasAttribute('data-testid'))sends[0].setAttribute('data-testid','send-button');
      }
      return node;
    }
    if(known.length===1)return compatible(known[0]);
    const labelled=candidates.filter(node=>/ask chatgpt|message chatgpt|send a message|message composer|prompt-textarea/i.test([node.getAttribute('placeholder'),node.getAttribute('data-placeholder'),node.getAttribute('aria-label'),node.getAttribute('data-testid')].filter(Boolean).join(' ')));
    if(labelled.length===1)return compatible(labelled[0]);
    return null;
  }
  const messageId=node=>node?.getAttribute('data-message-id')||node?.getAttribute('data-turn-id')||node?.closest('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id')||node?.closest('[data-chatgpt-search-message-ids]')?.getAttribute('data-chatgpt-search-message-ids')||node?.id||null;
  const markdown=new TurndownService({headingStyle:'atx',bulletListMarker:'-',codeBlockStyle:'fenced',emDelimiter:'*'});
  markdown.use(gfm);
  // Literal HTML-looking text must stay text when rendered on the dashboard.
  const escapeMarkdown=markdown.escape.bind(markdown);
  markdown.escape=value=>escapeMarkdown(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  markdown.addRule('tableCell',{
    filter:['th','td'],
    replacement:(content,node)=>(node.previousElementSibling?' ':'| ')+content.trim().replace(/\|/g,'\\|').replace(/\n+/g,'<br>')+' |'
  });
  markdown.addRule('safeLinks',{
    filter:node=>node.nodeName==='A'&&(!/^https?:\/\//i.test(node.getAttribute('href')||'')||/^https?:\/\/(?:[^/]+\.)?(?:chatgpt\.com|chat\.openai\.com)(?:[/:]|$)/i.test(node.getAttribute('href'))),
    replacement:content=>content
  });
  function text(node){
    if(!node)return '';
    const content=node.matches('[data-markdown-text-style]')?node:node.querySelector('[data-message-content],[data-markdown-text-style],.markdown,.prose')||node;
    // ChatGPT can render consecutive scheduled briefings in one Markdown root.
    // Split only repeated, explicitly dated briefing titles; ordinary headings
    // and other task reports are preserved in full.
    const briefingTitles=[...content.querySelectorAll('h1,h2')].filter(heading=>/daily (?:interest )?briefing/i.test(heading.textContent)&&/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2}\b|\b20\d{2}-\d{2}-\d{2}\b/i.test(heading.textContent));
    const start=briefingTitles.length>1?briefingTitles.at(-1):null;
    const user=node.matches('[data-user-message-bubble]')||selectors('user').some(selector=>node.matches(selector));
    if(!user){
      // Filter the live DOM before conversion so hidden controls and prior
      // grouped reports cannot leak into the saved reply. Never mutate the chat.
      function copy(element){
        if(start&&element!==start&&!element.contains(start)&&(element.compareDocumentPosition(start)&Node.DOCUMENT_POSITION_FOLLOWING))return null;
        if(element.nodeType===Node.TEXT_NODE)return element.cloneNode();
        if(element.nodeType!==Node.ELEMENT_NODE)return null;
        if(element.matches('button,[role="toolbar"],.sr-only,[aria-hidden="true"],script,style,iframe,svg,img'))return null;
        const style=getComputedStyle(element);if(style.display==='none'||style.visibility==='hidden')return null;
        if(element.tagName==='TABLE'&&!element.rows.length)return null;
        const clone=element.cloneNode(false);
        for(const attr of [...clone.attributes])if(!['href','title','start','colspan','rowspan','align','class'].includes(attr.name))clone.removeAttribute(attr.name);
        if(element.tagName==='A'&&element.hasAttribute('href'))clone.setAttribute('href',element.href);
        for(const child of element.childNodes){
          if(['TABLE','THEAD','TBODY','TFOOT','TR'].includes(element.tagName)&&child.nodeType===Node.TEXT_NODE&&!child.textContent.trim())continue;
          const next=copy(child);if(next)clone.append(next);
        }
        return clone;
      }
      const clone=copy(content);
      return clone?markdown.turndown(clone).trim():'';
    }
    // User messages remain plain text for exact retry-prompt confirmation.
    const blocks=new Set(['P','DIV','SECTION','ARTICLE','H1','H2','H3','H4','H5','H6','UL','OL','BLOCKQUOTE','PRE','TABLE','THEAD','TBODY','TR']);
    function render(element){
      if(start&&element!==start&&!element.contains(start)&&(element.compareDocumentPosition(start)&Node.DOCUMENT_POSITION_FOLLOWING))return '';
      if(element.nodeType===Node.TEXT_NODE)return element.textContent;
      if(element.nodeType!==Node.ELEMENT_NODE)return '';
      if(element.matches('button,[role="toolbar"],.sr-only,[aria-hidden="true"],script,style'))return '';
      const style=getComputedStyle(element);if(style.display==='none'||style.visibility==='hidden')return '';
      if(element.tagName==='BR')return '\n';
      const body=[...element.childNodes].map(render).join('');
      if(element.tagName==='LI')return '\n• '+body.trim()+'\n';
      return blocks.has(element.tagName)?'\n'+body.trim()+'\n':body;
    }
    return render(content).replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  const streaming=()=>[...document.querySelectorAll('[data-testid="stop-button"],[data-is-streaming="true"],button[aria-label="Stop generating"],button[aria-label="Stop streaming"],button[aria-label="Stop responding"],button[aria-label="Stop response"],button[aria-label="Stop"]')].some(visible);
  function describe(node){
    const attrs=['id','role','data-testid','data-message-id','data-turn-id','data-message-author-role','data-turn','data-role','data-author','data-message-role','contenteditable','placeholder','data-placeholder','aria-label'];
    const dataNames=[...node.attributes].map(attr=>attr.name).filter(name=>name.startsWith('data-')&&!attrs.includes(name));
    return [node.tagName.toLowerCase(),...attrs.filter(name=>node.hasAttribute(name)).map(name=>name+'='+node.getAttribute(name).slice(0,100)),'class='+String(node.className||'').slice(0,240),'data-attributes='+dataNames.join(',')].join(' ').slice(0,700);
  }
  function structure(){
    const relevant=[...document.querySelectorAll('textarea,[contenteditable],[role="textbox"],main,article,section,[role="main"],iframe')];
    const named=[...document.querySelectorAll('[class],[data-testid]')].filter(node=>/message|markdown|prose|composer|prompt|chat-turn/i.test(String(node.className||'')+' '+(node.getAttribute('data-testid')||'')));
    const samples=[...document.querySelectorAll('[class*="MarkdownRoot-"],[class~="group/user-message"]')].slice(-8).map(node=>{
      const ancestry=[];for(let parent=node,depth=0;parent&&depth<6;parent=parent.parentElement,depth++)ancestry.push(describe(parent));
      return ancestry.join('\n  <- ');
    });
    return 'MESSAGE CONTAINERS\n'+samples.join('\n\n')+'\nPAGE ELEMENTS\n'+[...new Set([...relevant,...named].map(describe))].slice(0,40).join('\n');
  }
  globalThis.dailyDeskDOM={visible,messages,editor,messageId,text,streaming,structure};
})();
