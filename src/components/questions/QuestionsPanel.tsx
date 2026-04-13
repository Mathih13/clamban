import { useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  CheckCheck,
  ChevronDown,
  ChevronUp,
  FileText,
  HelpCircle,
  Send,
  CheckSquare,
} from "lucide-react";
import { differenceInMinutes } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { PRIORITY_CONFIG } from "@/lib/constants";
import type { Task, Question } from "@/types/board";

interface QuestionsPanelProps {
  tasks: Task[];
  onAnswer: (taskId: string, questionId: string, answer: string) => void;
  onTaskClick: (task: Task) => void;
}

// --- Helpers ---

function isPlanApproval(q: Question): boolean {
  return !q.answer && !!q.options?.some((o) => o.label === "Approve");
}

function urgencyColor(askedAt: string): string {
  const mins = differenceInMinutes(new Date(), new Date(askedAt));
  if (mins < 5) return "bg-green-500";
  if (mins < 30) return "bg-amber-500";
  return "bg-red-500";
}

function urgencyLabel(askedAt: string): string {
  const mins = differenceInMinutes(new Date(), new Date(askedAt));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

interface PendingItem {
  task: Task;
  question: Question;
}

// --- Inline answer subcomponent (unchanged logic) ---

function InlineQuestionAnswer({
  question,
  onSubmit,
}: {
  question: Question;
  onSubmit: (answer: string) => void;
}) {
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const hasOptions = question.options && question.options.length > 0;

  function handleOptionClick(label: string) {
    if (question.multiSelect) {
      setSelectedOptions((prev) =>
        prev.includes(label) ? prev.filter((o) => o !== label) : [...prev, label]
      );
      setShowCustom(false);
    } else {
      setSelectedOptions([label]);
      setShowCustom(false);
    }
  }

  function handleSubmit() {
    let answer: string;
    if (showCustom && customText.trim()) {
      answer = customText.trim();
    } else if (selectedOptions.length > 0) {
      answer = selectedOptions.join(", ");
    } else {
      return;
    }
    onSubmit(answer);
  }

  return (
    <div className="space-y-2 mt-2">
      {hasOptions && (
        <div className="grid gap-1.5">
          {question.options!.map((opt) => {
            const isSelected = selectedOptions.includes(opt.label);
            return (
              <button
                key={opt.label}
                onClick={() => handleOptionClick(opt.label)}
                className={`text-left rounded border px-3 py-2 transition-colors text-sm ${
                  isSelected
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/50"
                }`}
              >
                <div className="flex items-start gap-2">
                  {question.multiSelect && (
                    <CheckSquare
                      className={`size-3.5 mt-0.5 shrink-0 ${
                        isSelected ? "text-primary" : "text-muted-foreground/40"
                      }`}
                    />
                  )}
                  <div>
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && (
                      <span className="text-muted-foreground ml-1.5">— {opt.description}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {hasOptions && (
        <button
          onClick={() => {
            setShowCustom(!showCustom);
            setSelectedOptions([]);
          }}
          className={`text-xs underline-offset-2 ${
            showCustom ? "text-primary underline" : "text-muted-foreground hover:underline"
          }`}
        >
          Other (custom answer)
        </button>
      )}
      {(showCustom || !hasOptions) && (
        <Textarea
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder="Type your answer..."
          rows={2}
          className="text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={showCustom || !hasOptions ? !customText.trim() : selectedOptions.length === 0}
        >
          <Send className="size-3 mr-1.5" />
          Answer
        </Button>
      </div>
    </div>
  );
}

// --- Single question card ---

function QuestionCard({
  item,
  onAnswer,
  onTaskClick,
}: {
  item: PendingItem;
  onAnswer: (taskId: string, questionId: string, answer: string) => void;
  onTaskClick: (task: Task) => void;
}) {
  const { task, question: q } = item;
  const priority = PRIORITY_CONFIG[task.priority];

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`size-2 rounded-full shrink-0 ${urgencyColor(q.askedAt)}`}
          title={`Waiting ${urgencyLabel(q.askedAt)}`}
        />
        <button
          onClick={() => onTaskClick(task)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors truncate"
        >
          {task.title}
        </button>
        <div
          className={`size-1.5 rounded-full shrink-0 ${priority.dotColor}`}
          title={priority.label}
        />
        {task.assignee && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
            {task.assignee}
          </Badge>
        )}
        <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
          {urgencyLabel(q.askedAt)}
        </span>
      </div>

      <p className="text-sm font-medium">{q.text}</p>
      <p className="text-xs text-muted-foreground">{q.author}</p>

      {q.details && (
        <div className="rounded-md border bg-muted/30 p-3 max-h-80 overflow-y-auto prose prose-sm prose-invert max-w-none">
          <ReactMarkdown>{q.details}</ReactMarkdown>
        </div>
      )}

      <InlineQuestionAnswer question={q} onSubmit={(answer) => onAnswer(task.id, q.id, answer)} />
    </div>
  );
}

// --- Main panel ---

export function QuestionsPanel({ tasks, onAnswer, onTaskClick }: QuestionsPanelProps) {
  const [expanded, setExpanded] = useState(true);

  // Flatten all pending questions into items with task context
  const allPending: PendingItem[] = [];
  for (const task of tasks) {
    for (const q of task.questions ?? []) {
      if (!q.answer) {
        allPending.push({ task, question: q });
      }
    }
  }

  if (allPending.length === 0) return null;

  // Split into plan approvals vs other questions
  const approvals = allPending
    .filter((item) => isPlanApproval(item.question))
    .sort(
      (a, b) => new Date(a.question.askedAt).getTime() - new Date(b.question.askedAt).getTime()
    );

  const questions = allPending
    .filter((item) => !isPlanApproval(item.question))
    .sort(
      (a, b) => new Date(a.question.askedAt).getTime() - new Date(b.question.askedAt).getTime()
    );

  function handleBatchApprove() {
    for (const item of approvals) {
      onAnswer(item.task.id, item.question.id, "Approve");
    }
  }

  return (
    <div className="border-b bg-card shrink-0">
      <div className="px-6 py-2 flex items-center justify-between">
        <button
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          onClick={() => setExpanded(!expanded)}
        >
          <HelpCircle className="size-4 text-amber-500" />
          <span className="text-sm font-medium text-amber-500">Pilot Inbox</span>
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-500"
          >
            {allPending.length}
          </Badge>
          {expanded ? (
            <ChevronUp className="size-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3 text-muted-foreground" />
          )}
        </button>
        {approvals.length >= 2 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleBatchApprove}
            className="text-xs gap-1.5"
          >
            <CheckCheck className="size-3.5" />
            Approve All Plans ({approvals.length})
          </Button>
        )}
      </div>
      {expanded && (
        <>
          <Separator />
          <div className="px-6 py-3 space-y-4 max-h-[600px] overflow-y-auto">
            {approvals.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <FileText className="size-3" />
                  Plan Approvals ({approvals.length})
                </div>
                {approvals.map((item) => (
                  <QuestionCard
                    key={item.question.id}
                    item={item}
                    onAnswer={onAnswer}
                    onTaskClick={onTaskClick}
                  />
                ))}
              </div>
            )}

            {approvals.length > 0 && questions.length > 0 && <Separator />}

            {questions.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <HelpCircle className="size-3" />
                  Questions ({questions.length})
                </div>
                {questions.map((item) => (
                  <QuestionCard
                    key={item.question.id}
                    item={item}
                    onAnswer={onAnswer}
                    onTaskClick={onTaskClick}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
