import { useState, useEffect } from "react";
import { Check, GitMerge, Loader2, MessageSquareWarning, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { DiffViewer } from "./DiffViewer";
import { api } from "@/lib/api-client";
import type { Comment } from "@/types/board";

interface ReviewTabProps {
  taskId: string;
  branch: string;
  comments: Comment[];
  onMerge: (taskId: string) => void;
  onRequestChanges: (taskId: string, feedback: string) => void;
}

function extractValidationStatus(comments: Comment[]): "passed" | "failed" | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    const text = comments[i].text;
    if (text.includes("[VALIDATION_PASSED]")) return "passed";
    if (text.includes("[VALIDATION_FAILED]")) return "failed";
  }
  return null;
}

export function ReviewTab({ taskId, branch, comments, onMerge, onRequestChanges }: ReviewTabProps) {
  const [diff, setDiff] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    files: number;
    additions: number;
    deletions: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getTaskDiff(taskId)
      .then((res) => {
        setDiff(res.diff);
        setStats(res.stats);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load diff");
      })
      .finally(() => setLoading(false));
  }, [taskId]);

  const validationStatus = extractValidationStatus(comments);

  async function handleMerge() {
    setMerging(true);
    try {
      onMerge(taskId);
    } finally {
      setMerging(false);
    }
  }

  function handleRequestChanges() {
    if (!feedback.trim()) return;
    onRequestChanges(taskId, feedback.trim());
    setFeedback("");
    setShowFeedback(false);
  }

  return (
    <div className="space-y-4">
      {/* Header: branch, stats, validation */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="text-xs font-mono">
          {branch}
        </Badge>
        {stats && (
          <span className="text-xs text-muted-foreground">
            {stats.files} file{stats.files !== 1 ? "s" : ""} changed
            {stats.additions > 0 && <span className="text-green-500 ml-1">+{stats.additions}</span>}
            {stats.deletions > 0 && <span className="text-red-500 ml-1">-{stats.deletions}</span>}
          </span>
        )}
        {validationStatus === "passed" && (
          <Badge className="bg-green-500/20 text-green-500 text-[10px] gap-1">
            <Check className="size-3" />
            Validation passed
          </Badge>
        )}
        {validationStatus === "failed" && (
          <Badge className="bg-red-500/20 text-red-500 text-[10px] gap-1">
            <X className="size-3" />
            Validation failed
          </Badge>
        )}
      </div>

      {/* Diff content */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" />
          Loading diff...
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}
      {diff !== null && !loading && <DiffViewer diff={diff} />}

      {/* Actions */}
      <div className="sticky bottom-0 flex items-center gap-2 pt-2 pb-1 border-t bg-background z-10">
        <Button
          onClick={handleMerge}
          disabled={merging || validationStatus === "failed"}
          className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
        >
          {merging ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <GitMerge className="size-3.5" />
          )}
          Approve & Merge
        </Button>
        {!showFeedback ? (
          <Button variant="outline" onClick={() => setShowFeedback(true)} className="gap-1.5">
            <MessageSquareWarning className="size-3.5" />
            Request Changes
          </Button>
        ) : (
          <div className="flex-1 flex gap-2">
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Describe what needs to change..."
              rows={2}
              className="flex-1 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleRequestChanges();
                }
              }}
            />
            <div className="flex flex-col gap-1">
              <Button size="sm" onClick={handleRequestChanges} disabled={!feedback.trim()}>
                Send
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowFeedback(false);
                  setFeedback("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
