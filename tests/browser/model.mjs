const realFetch = globalThis.fetch;
let modelMode = 'ready';
export function setModelMode(value) { modelMode = value; }
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
  if (url.origin !== 'https://model.example.test') return realFetch(input, init);
  if (url.pathname !== '/v1/chat/completions') throw new Error('Unexpected model path');
  const body = await new Request(input, init).json();
  if (!body.messages[1].content.some(part => part.image_url?.url.startsWith('data:image/'))) {
    throw new Error('Model did not receive the uploaded image');
  }
  return Response.json({ choices: [{ message: { content: JSON.stringify(modelMode === 'failed'
    ? { stage: 'invalid' }
    : { title: '[E2E] 合成方程', question_markdown: '$x+2=5$', correct_answer: '3',
      solution_markdown: '两边同时减去 2，得到 $x=3$。', stage: 'primary', grade: 5,
      knowledge_points: ['方程'], error_type: 'unknown', image_required: true,
      recognition_notes: '模拟模型，仅供自动验收。' }) } }] });
};
