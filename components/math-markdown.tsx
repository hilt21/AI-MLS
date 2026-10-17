'use client';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
export function MathMarkdown({source}:{source:string}){
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}
    // Do not let user-/model-supplied Markdown request external images or hyperlinks.
    components={{img:()=>null,a:({children})=><span>{children}</span>}}>{source||'（内容待补充）'}</ReactMarkdown></div>;
}
