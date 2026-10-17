import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';
export const metadata: Metadata = {
  title: '错题进步簿 · 学生学习实验室',
  description: '上传错题、核对内容、独立重做、按复习计划巩固知识',
  robots: { index: false, follow: false },
};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="zh-CN"><body>{children}</body></html>;
}
