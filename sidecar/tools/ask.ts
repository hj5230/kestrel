import { Type } from "typebox";
import type { AskDetails, Question, QuestionAnswer } from "../../shared/protocol";
import { defineTool, text, type KestrelTool, type ToolContext } from "./types";

const DISMISSED =
  "The user dismissed the question without answering. Don't ask it again right away: continue with your best judgment if the choice is low-risk, " +
  "otherwise stop and say what you need.";

/** Whatever the client sent, reduced to what the questions allow: known ids only, one pick for single-choice, bounded free text. */
export function sanitizeAnswers(questions: Question[], answers: QuestionAnswer[]): QuestionAnswer[] {
  return questions.map((q) => {
    const a = Array.isArray(answers) ? answers.find((x) => x?.questionId === q.id) : undefined;
    const valid = new Set(q.options.map((o) => o.id));
    let ids = [...new Set((Array.isArray(a?.optionIds) ? a!.optionIds : []).map(String))].filter((id) => valid.has(id));
    if (!q.allowMultiple) ids = ids.slice(0, 1);
    const other = typeof a?.other === "string" ? a.other.trim().slice(0, 4000) : "";
    return { questionId: q.id, optionIds: ids, ...(other ? { other } : {}) };
  });
}

/** The answers as the agent reads them: the question, then the chosen labels and/or the user's own words. */
export function formatAnswers(questions: Question[], answers: QuestionAnswer[]): string {
  return questions
    .map((q) => {
      const a = answers.find((x) => x.questionId === q.id);
      const picked = (a?.optionIds ?? []).map((id) => q.options.find((o) => o.id === id)?.label).filter((l): l is string => !!l);
      const other = a?.other?.trim();
      const parts = [...picked, ...(other ? [`Other: ${other}`] : [])];
      return `Q: ${q.prompt}\nA: ${parts.length ? parts.join("; ") : "(no answer)"}`;
    })
    .join("\n\n");
}

export function createAskUserTool(ctx: ToolContext): KestrelTool {
  return defineTool({
    name: "ask_user",
    label: "Ask the user",
    category: "meta",
    description:
      "Ask the user one or more multiple-choice questions and wait for the answers. Use it to settle a decision that is the user's to make: " +
      "ambiguous requirements, a choice between approaches, or a proposal that needs a go-ahead before you do something large or hard to undo. " +
      "Don't use it for things you can find out yourself or for routine confirmations; the permission system already asks before risky tool calls. " +
      "Put the option you recommend first and set recommended on it. Each question automatically also offers an 'Other' free-text answer, so don't add one. " +
      "Keep the questions few and the options short; put the trade-offs in each option's description. " +
      "To propose a plan, summarise it in your message first, then ask with options such as 'Go ahead' and 'Change something'.",
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: "Short heading for the whole set, e.g. 'Before I refactor the parser'" })),
      questions: Type.Array(
        Type.Object({
          question: Type.String({ description: "The question, complete enough to be understood on its own" }),
          options: Type.Array(
            Type.Object({
              label: Type.String({ description: "Short choice text (1-6 words)" }),
              description: Type.Optional(Type.String({ description: "What picking it means or costs" })),
              recommended: Type.Optional(Type.Boolean({ description: "Mark your suggested choice" })),
            }),
            { minItems: 2, maxItems: 8 },
          ),
          multiple: Type.Optional(Type.Boolean({ description: "Allow selecting several options" })),
        }),
        { minItems: 1, maxItems: 5 },
      ),
    }),
    async execute(toolCallId, params, signal) {
      const questions: Question[] = params.questions.map((q, i) => {
        const options = q.options.map((o, j) => ({ id: String(j + 1), label: o.label, description: o.description, recommended: o.recommended }));
        // Recommended options go first, otherwise the order the agent gave.
        options.sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended));
        return { id: `q${i + 1}`, prompt: q.question, options, allowMultiple: q.multiple };
      });
      const answers = await ctx.ask({ toolCallId, title: params.title, questions }, signal);
      const details: AskDetails = { title: params.title, questions, answers };
      if (!answers) return { content: text(DISMISSED), details };
      return { content: text(formatAnswers(questions, answers)), details };
    },
  });
}
