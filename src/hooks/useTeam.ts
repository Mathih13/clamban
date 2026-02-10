import { useState, useEffect, useCallback } from "react";
import { api, type TeamResponse } from "@/lib/api-client";
import { toast } from "sonner";

export function useTeam() {
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTeam = useCallback(async () => {
    try {
      const data = await api.getTeam();
      setTeam(data);
    } catch (err) {
      console.error("Failed to fetch team:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Listen for team-changed SSE events
  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "team-changed" || data.type === "board-changed") {
        fetchTeam();
      }
    };

    return () => es.close();
  }, [fetchTeam]);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  const connect = useCallback(
    async (config: { teamName: string; projectDir: string; model?: string; maxTurns?: number }) => {
      await api.connectTeam(config);
      await fetchTeam();
      toast.success("Team connected");
    },
    [fetchTeam]
  );

  const disconnect = useCallback(async () => {
    await api.disconnectTeam();
    await fetchTeam();
    toast.success("Team disconnected");
  }, [fetchTeam]);

  const start = useCallback(async () => {
    await api.startTeam();
    await fetchTeam();
    toast.success("Team started");
  }, [fetchTeam]);

  const stop = useCallback(async () => {
    await api.stopTeam();
    await fetchTeam();
    toast.success("Team stopped");
  }, [fetchTeam]);

  const memberNames = team?.state?.members?.map((m) => m.name) ?? [];

  return {
    team,
    loading: loading,
    connected: team?.connected ?? false,
    running: team?.state?.running ?? false,
    config: team?.config,
    state: team?.state,
    memberNames,
    connect,
    disconnect,
    start,
    stop,
    refetch: fetchTeam,
  };
}
