import { useState, useEffect, useRef, useCallback } from "react";
import { Terminal, Pause, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api-client";

interface TeamOutputProps {
  running: boolean;
}

export function TeamOutput({ running }: TeamOutputProps) {
  const [content, setContent] = useState("");
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevContentLenRef = useRef(0);

  const fetchLogs = useCallback(async () => {
    if (paused) return;
    try {
      const res = await api.getTeamLogs(500);
      setContent(res.content);
    } catch {}
  }, [paused]);

  // Poll for updates
  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (paused) return;
    if (content.length > prevContentLenRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevContentLenRef.current = content.length;
  }, [content, paused]);

  return (
    <div className="flex flex-col border-t bg-zinc-950">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 text-zinc-500" />
          <span className="text-xs font-medium text-zinc-400">Output</span>
          {running && (
            <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={() => setPaused((p) => !p)}
            title={paused ? "Resume auto-scroll" : "Pause auto-scroll"}
          >
            {paused ? (
              <Play className="size-3 text-zinc-500" />
            ) : (
              <Pause className="size-3 text-zinc-500" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={() => { setContent(""); prevContentLenRef.current = 0; }}
            title="Clear display"
          >
            <Trash2 className="size-3 text-zinc-500" />
          </Button>
        </div>
      </div>
      <ScrollArea className="h-56" ref={scrollRef}>
        <pre className="p-3 text-[11px] leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap break-words">
          {content || (
            <span className="text-zinc-600">
              {running ? "Waiting for output..." : "No output yet. Start the team to see logs."}
            </span>
          )}
          <div ref={bottomRef} />
        </pre>
      </ScrollArea>
    </div>
  );
}
