import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { formatDistanceToNow } from "date-fns";
import { Check, CheckSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Question } from "@/types/board";

interface QuestionThreadProps {
  questions: Question[];
  onAnswer: (questionId: string, answer: string) => void;
}

function QuestionItem({
  question,
  onAnswer,
}: {
  question: Question;
  onAnswer: (questionId: string, answer: string) => void;
}) {
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const isAnswered = !!question.answer;

  function handleOptionClick(label: string) {
    if (isAnswered) return;
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
    if (isAnswered) return;
    let answer: string;
    if (showCustom && customText.trim()) {
      answer = customText.trim();
    } else if (selectedOptions.length > 0) {
      answer = selectedOptions.join(", ");
    } else {
      return;
    }
    onAnswer(question.id, answer);
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-sm font-medium">{question.text}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Asked by {question.author}{" "}
            {formatDistanceToNow(new Date(question.askedAt), {
              addSuffix: true,
            })}
          </p>
        </div>
        {isAnswered && <Check className="size-4 text-green-500 shrink-0 mt-0.5" />}
      </div>

      {question.details && (
        <div className="rounded-md border bg-muted/30 p-3 max-h-96 overflow-y-auto prose prose-sm prose-invert max-w-none">
          <ReactMarkdown>{question.details}</ReactMarkdown>
        </div>
      )}

      {question.options && question.options.length > 0 && (
        <div className="grid gap-2">
          {question.options.map((opt) => {
            const isSelected = isAnswered
              ? question.answer?.includes(opt.label)
              : selectedOptions.includes(opt.label);
            return (
              <button
                key={opt.label}
                onClick={() => handleOptionClick(opt.label)}
                disabled={isAnswered}
                className={`text-left rounded-md border p-3 transition-colors ${
                  isSelected
                    ? isAnswered
                      ? "border-green-500/50 bg-green-500/10"
                      : "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/50"
                } ${isAnswered ? "cursor-default" : "cursor-pointer"}`}
              >
                <div className="flex items-start gap-2">
                  {question.multiSelect && (
                    <CheckSquare
                      className={`size-4 mt-0.5 shrink-0 ${
                        isSelected ? "text-primary" : "text-muted-foreground/40"
                      }`}
                    />
                  )}
                  <div>
                    <p className="text-sm font-medium">{opt.label}</p>
                    {opt.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {isAnswered ? (
        <div className="rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground mb-1">Answer</p>
          <p className="text-sm">{question.answer}</p>
          {question.answeredAt && (
            <p className="text-xs text-muted-foreground mt-1">
              Answered{" "}
              {formatDistanceToNow(new Date(question.answeredAt), {
                addSuffix: true,
              })}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {question.options && question.options.length > 0 && (
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
          {(showCustom || !question.options || question.options.length === 0) && (
            <Textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Type your answer..."
              rows={2}
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
              disabled={
                showCustom || !question.options || question.options.length === 0
                  ? !customText.trim()
                  : selectedOptions.length === 0
              }
            >
              <Send className="size-3.5 mr-1.5" />
              Answer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function QuestionThread({ questions, onAnswer }: QuestionThreadProps) {
  if (questions.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">No questions yet</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {questions.map((question) => (
        <QuestionItem key={question.id} question={question} onAnswer={onAnswer} />
      ))}
    </div>
  );
}
