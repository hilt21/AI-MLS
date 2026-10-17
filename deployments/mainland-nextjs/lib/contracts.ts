import { z } from 'zod';

export const StageSchema = z.enum(['primary', 'junior']);
export const QuestionSchema = z.object({
  title: z.string().trim().min(1).max(150),
  question_markdown: z.string().trim().min(1).max(20000),
  solution_markdown: z.string().max(20000).default(''),
  correct_answer: z.string().max(5000).default(''),
  student_wrong_answer: z.string().max(5000).default(''),
  stage: StageSchema,
  grade: z.number().int().min(1).max(9),
  knowledge_points: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  error_type: z.enum(['unknown', 'concept', 'calculation', 'reading', 'method', 'careless']).default('unknown'),
  image_required: z.boolean().default(false),
  recognition_notes: z.string().max(1000).default(''),
});
export type QuestionDraft = z.infer<typeof QuestionSchema>;

export const QuestionEditSchema = QuestionSchema.pick({
  title: true, question_markdown: true, solution_markdown: true,
  correct_answer: true, student_wrong_answer: true, stage: true,
  grade: true, knowledge_points: true, error_type: true, image_required: true,
}).refine(q=>q.stage==='primary'?q.grade<=6:q.grade>=7,{message:'学段与年级不匹配'});
export const ReviewInputSchema = z.object({
  questionId: z.string().uuid(),
  submissionId: z.string().uuid(),
  rawAnswer: z.string().trim().max(5000).default(''),
  selfReportCorrect: z.boolean(),
  usedHint: z.boolean(),
  selfRating: z.enum(['again', 'hard', 'good', 'easy']),
});
export const LoginSchema = z.object({
  username: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,29}$/),
  password: z.string().min(8).max(128),
});
