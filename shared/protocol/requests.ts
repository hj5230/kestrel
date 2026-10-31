// What a run asks of the user: tool approvals and multiple-choice questions.

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  args: any;
  kind: "bash" | "edit" | "tool";
  path: string | null;
  detail: string;
  subagent: boolean;
  whitelistSuggestion: string | null;
  /** Why a person is asked when it is more than "nothing allows this" (credentials, auto-review said no, …). */
  note: ApprovalNote | null;
  createdAt: number;
}

export type ApprovalNoteCode =
  | "protected_path" // a startup file, git hook, credential store or agent config
  | "sensitive_read" // reading credentials
  | "critical_delete" // deleting or moving `/`, the home folder or a folder directly under it
  | "outside_project" // editing a file outside the working folder
  | "review_blocked" // the auto-review model said no and the agent kept pushing
  | "review_error" // the auto-review model could not be reached
  | "review_paused"; // too many blocks in a row: auto mode paused until you approve something


export interface ApprovalNote {
  code: ApprovalNoteCode;
  /** The path or the reviewer's one-line reason. */
  detail?: string;
}

export type ApprovalDecision = "allow_once" | "allow_always" | "deny";

/** A multiple-choice question the agent puts to the user (the `ask_user` tool). */
export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
  /** The agent's suggested choice, shown first and marked. */
  recommended?: boolean;
}

export interface Question {
  id: string;
  prompt: string;
  options: QuestionOption[];
  allowMultiple?: boolean;
}

export interface QuestionRequest {
  id: string;
  sessionId: string;
  toolCallId: string;
  title?: string;
  questions: Question[];
  createdAt: number;
}

/** One answer per question: the chosen option ids and/or free text (every question also accepts "Other"). */
export interface QuestionAnswer {
  questionId: string;
  optionIds: string[];
  other?: string;
}

/** Stored on the `ask_user` tool result so the transcript can show what was asked and answered. */
export interface AskDetails {
  title?: string;
  questions: Question[];
  /** null: the user dismissed the questions without answering. */
  answers: QuestionAnswer[] | null;
}
