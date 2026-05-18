"use client";

import * as React from "react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "./Modal";
import { Button } from "./Button";

export type ConfirmOptions = {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
};

type Resolver = (value: boolean) => void;

type State =
  | { open: false }
  | { open: true; opts: ConfirmOptions; resolve: Resolver };

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = React.useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return fn;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<State>({ open: false });

  const confirm = React.useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, opts, resolve });
    });
  }, []);

  function close(value: boolean) {
    if (!state.open) return;
    state.resolve(value);
    setState({ open: false });
  }

  const titleId = "confirm-modal-title";
  const bodyId = "confirm-modal-body";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={state.open}
        onClose={() => close(false)}
        size="sm"
        labelledBy={titleId}
        describedBy={bodyId}
      >
        {state.open && (
          <>
            <ModalHeader id={titleId}>{state.opts.title}</ModalHeader>
            {state.opts.message && (
              <ModalBody id={bodyId}>{state.opts.message}</ModalBody>
            )}
            <ModalFooter>
              <Button variant="secondary" size="sm" onClick={() => close(false)}>
                {state.opts.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={state.opts.tone === "primary" ? "primary" : "danger"}
                size="sm"
                onClick={() => close(true)}
                data-autofocus
              >
                {state.opts.confirmLabel ?? "Confirm"}
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}
