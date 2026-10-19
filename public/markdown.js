import {Marked} from '/vendor/marked.js';
import DOMPurify from '/vendor/dompurify.js';

const parser=new Marked({gfm:true,breaks:false,async:false});
export function safeUrl(value){
  try{
    const url=new URL(value);
    return ['http:','https:'].includes(url.protocol)&&!['chatgpt.com','chat.openai.com'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host))?url.href:null;
  }catch{return null;}
}

export function renderMarkdown(text){
  const fragment=DOMPurify.sanitize(parser.parse(String(text||'')),{
    RETURN_DOM_FRAGMENT:true,
    ALLOWED_TAGS:['p','br','hr','h1','h2','h3','h4','h5','h6','strong','b','em','i','del','s','ul','ol','li','blockquote','pre','code','a','table','caption','thead','tbody','tfoot','tr','th','td','sup','sub'],
    ALLOWED_ATTR:['href','title','start','colspan','rowspan','align'],
    ALLOW_DATA_ATTR:false,
    ALLOW_ARIA_ATTR:false
  });
  for(const link of fragment.querySelectorAll('a')){
    const url=safeUrl(link.getAttribute('href'));
    if(!url){link.replaceWith(...link.childNodes);continue;}
    link.href=url;link.target='_blank';link.rel='noopener noreferrer';
  }
  for(const table of fragment.querySelectorAll('table')){
    const scroll=document.createElement('div');
    scroll.className='table-scroll';scroll.tabIndex=0;
    scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Response table');
    table.replaceWith(scroll);scroll.append(table);
  }
  return fragment;
}
