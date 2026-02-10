import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CommentItem } from "./CommentItem";
import type { Comment } from "@/types/board";

interface CommentThreadProps {
  comments: Comment[];
  onAddComment: (text: string) => void;
}

export function CommentThread({ comments, onAddComment }: CommentThreadProps) {
  const [text, setText] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    onAddComment(text.trim());
    setText("");
  }

  return (
    <div className="flex flex-col gap-4">
      {comments.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No comments yet
        </p>
      )}
      {comments.map((comment) => (
        <CommentItem key={comment.id} comment={comment} />
      ))}
      <form onSubmit={handleSubmit} className="flex gap-2 mt-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment..."
          rows={2}
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSubmit(e);
            }
          }}
        />
        <Button type="submit" size="icon" disabled={!text.trim()} className="shrink-0 self-end">
          <Send />
        </Button>
      </form>
    </div>
  );
}
