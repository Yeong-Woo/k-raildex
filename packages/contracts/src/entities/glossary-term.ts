/** 용어 glossary_term (docs/03-data-model.md 4-18절). 본문 필드는 마크다운 */
import { z } from 'zod';
import { idSchema } from '../ids';
import { curatedFields, defineContract, optText, recReadFields } from './common';

const shape = {
  id: idSchema('glossary_term'),
  term_ko: z.string().min(1),
  term_en: optText(),
  section: z.string().min(1),
  definition: z.string().min(1),
  basis: optText(),
  example: optText(),
  caution: optText(),
  ord: z.number().int(),
  ...curatedFields,
};

const contract = defineContract(shape, recReadFields);

export const GlossaryTermCreateSchema = contract.create;
export const GlossaryTermUpdateSchema = contract.update;
export const GlossaryTermReadSchema = contract.read;
export type GlossaryTermCreate = z.infer<typeof GlossaryTermCreateSchema>;
export type GlossaryTermUpdate = z.infer<typeof GlossaryTermUpdateSchema>;
export type GlossaryTermRead = z.infer<typeof GlossaryTermReadSchema>;
