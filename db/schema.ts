import { sqliteTable,text,integer } from 'drizzle-orm/sqlite-core';
export const questions=sqliteTable('questions',{id:text('id').primaryKey(),owner:text('owner').notNull(),data:text('data').notNull(),status:text('status').notNull(),image:text('image'),created:text('created').notNull(),due:text('due'),card:text('card'),version:integer('version').notNull().default(0)});
export const attempts=sqliteTable('attempts',{id:text('id').primaryKey(),owner:text('owner').notNull(),question:text('question').notNull(),data:text('data').notNull(),created:text('created').notNull()});
