import { useCallback, useEffect, useState } from "react";
import {
  type MooAccountError,
  type MooAccountRequest,
  type MooAccountState,
  requestMooAccountDataConsent,
  sendMooAccountRequest,
} from "./accountMessages";

export type MooAccountUiState = {
  state: MooAccountState | null;
  error: MooAccountError | null;
  pendingCommand: MooAccountRequest["command"] | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

export function useMooAccount(): MooAccountUiState {
  const [state, setState] = useState<MooAccountState | null>(null);
  const [error, setError] = useState<MooAccountError | null>(null);
  const [pendingCommand, setPendingCommand] = useState<MooAccountRequest["command"] | null>(null);

  const execute = useCallback(async (command: MooAccountRequest["command"]): Promise<void> => {
    setPendingCommand(command);
    setError(null);
    if (command === "mooAccount:signIn" && !(await requestMooAccountDataConsent())) {
      setError({
        code: "not_allowed",
        message: "Moo Account sign-in needs permission to share account identity data.",
      });
      setPendingCommand(null);
      return;
    }
    const response = await sendMooAccountRequest({ command });
    setState(response.state);
    if (!response.ok) setError(response.error);
    setPendingCommand(null);
  }, []);

  useEffect(() => {
    let active = true;
    void sendMooAccountRequest({ command: "mooAccount:getState" }).then((response) => {
      if (!active) return;
      setState(response.state);
      if (!response.ok) setError(response.error);
    });
    return () => {
      active = false;
    };
  }, []);

  return {
    state,
    error,
    pendingCommand,
    signIn: () => execute("mooAccount:signIn"),
    signOut: () => execute("mooAccount:signOut"),
  };
}
