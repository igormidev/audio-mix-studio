import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Music2,
  ShieldCheck,
  X,
} from "lucide-react";
import type { EpidemicConnection } from "../shared/epidemic";
import "./epidemic.css";

export function epidemicErrorMessage(
  failure: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  return failure instanceof Error
    ? failure.message.replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/u,
        "",
      )
    : fallback;
}

export function useEpidemicDialogFocus(
  container: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const element = container.current;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () =>
      Array.from(
        element?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
        ) ?? [],
      ).filter((item) => item.getClientRects().length > 0);
    controls()[0]?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        escape.current();
      }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [active, container]);
}

export function EpidemicKeyForm({
  onConnected,
  onCancel,
  onBusyChange,
  replace = false,
}: {
  onConnected: (status: EpidemicConnection) => void;
  onCancel?: () => void;
  onBusyChange?: (busy: boolean) => void;
  replace?: boolean;
}) {
  const [step, setStep] = useState<"choice" | "help" | "key">(
    replace ? "key" : "choice",
  );
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState<EpidemicConnection | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<string | null>(null);
  const generation = useRef(0);
  const callbacks = useRef({ onConnected, onCancel, onBusyChange });
  callbacks.current = { onConnected, onCancel, onBusyChange };
  useEffect(() => {
    if (step === "key") input.current?.focus();
  }, [step]);
  useEffect(
    () => () => {
      generation.current++;
      if (request.current) {
        void window.studio
          .epidemicCancel(request.current)
          .catch(() => undefined);
        callbacks.current.onBusyChange?.(false);
      }
    },
    [],
  );
  const cancelVerification = () => {
    generation.current++;
    if (request.current)
      void window.studio.epidemicCancel(request.current).catch(() => undefined);
    request.current = null;
    setBusy(false);
    setError("");
    callbacks.current.onBusyChange?.(false);
  };
  const verify = async () => {
    if (busy || !key.trim()) return;
    const id = crypto.randomUUID();
    const run = ++generation.current;
    request.current = id;
    setBusy(true);
    setError("");
    callbacks.current.onBusyChange?.(true);
    try {
      const status = await window.studio.epidemicConnect(key.trim(), id);
      if (run !== generation.current) return;
      if (!status.connected)
        throw new Error("The key could not be verified. Try again.");
      setKey("");
      setVerified(status);
    } catch (failure) {
      if (run !== generation.current) return;
      setError(
        epidemicErrorMessage(
          failure,
          "Could not verify this API key. Please try again.",
        ),
      );
    } finally {
      if (run === generation.current) {
        request.current = null;
        setBusy(false);
        callbacks.current.onBusyChange?.(false);
      }
    }
  };
  return (
    <div
      className="epidemic-key-form"
      onKeyDown={(event) => {
        if (event.key === "Escape" && busy) {
          event.preventDefault();
          event.stopPropagation();
          cancelVerification();
        }
      }}
    >
      {verified ? (
        <div className="epidemic-key-success" role="status">
          <span className="epidemic-success-symbol">
            <ShieldCheck size={30} />
          </span>
          <h3>API key verified</h3>
          <p>
            {verified.secureStorage
              ? "Your catalog is ready. Your key is encrypted on this Mac."
              : "Your catalog is ready for this session. Secure storage is unavailable, so your key has not been saved."}
          </p>
          <button
            className="button primary"
            onClick={() => {
              onConnected(verified);
              window.dispatchEvent(new Event("epidemic-connection-changed"));
            }}
          >
            Continue <ArrowRight size={15} />
          </button>
        </div>
      ) : step === "choice" ? (
        <>
          <span className="epidemic-key-symbol">
            <KeyRound size={27} />
          </span>
          <h3>Do you have an Epidemic Sound API key?</h3>
          <p>
            Connect your own Epidemic Sound account to browse, listen, and bring
            music into your mix.
          </p>
          <div className="epidemic-key-choices">
            <button
              aria-label="I have an API key"
              onClick={() => setStep("key")}
            >
              <KeyRound size={21} />
              <span>
                <strong>I have an API key</strong>
                <small>Paste it and verify your connection</small>
              </span>
              <ArrowRight size={17} />
            </button>
            <button aria-label="I need a key" onClick={() => setStep("help")}>
              <ExternalLink size={21} />
              <span>
                <strong>I need a key</strong>
                <small>Create one in your Epidemic Sound account</small>
              </span>
              <ArrowRight size={17} />
            </button>
          </div>
        </>
      ) : step === "help" ? (
        <>
          <button className="text-button" onClick={() => setStep("choice")}>
            <ArrowLeft size={13} />
            Back
          </button>
          <h3>Create your account API key</h3>
          <ol className="epidemic-key-steps">
            <li>Sign in to your Epidemic Sound account.</li>
            <li>
              Open <strong>Account → API keys</strong> and create an MCP Server
              API key.
            </li>
            <li>Copy the key, return here, and verify it.</li>
          </ol>
          <p className="epidemic-subtle">
            An account MCP Server key works with your subscription. Developer
            Portal API keys are for a different service.
          </p>
          <div className="epidemic-key-help-actions">
            <button
              className="button secondary"
              onClick={() => void window.studio.openExternal("epidemic-key")}
            >
              <ExternalLink size={14} />
              Open API keys
            </button>
            <button className="button primary" onClick={() => setStep("key")}>
              I have my key
              <ArrowRight size={14} />
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
        >
          {!replace && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setStep("choice");
                setError("");
              }}
            >
              <ArrowLeft size={13} />
              Back
            </button>
          )}
          <h3>
            {replace ? "Verify a replacement key" : "Connect Epidemic Sound"}
          </h3>
          <p>
            Enter the MCP Server API key from your account. We test it with
            Epidemic Sound before saving it.
          </p>
          <label className="field-label" htmlFor="epidemic-api-key">
            Epidemic Sound API key
          </label>
          <div className="epidemic-secret-field">
            <KeyRound size={16} />
            <input
              ref={input}
              id="epidemic-api-key"
              aria-label="Epidemic Sound API key"
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              disabled={busy}
              autoComplete="new-password"
              spellCheck={false}
              placeholder="Paste your account API key"
            />
          </div>
          <div className="epidemic-key-security">
            <LockKeyhole size={13} />
            <span>
              Kept out of projects and exports. Saved only with system
              encryption.
            </span>
          </div>
          {error && (
            <div className="epidemic-error" role="alert">
              {error}
            </div>
          )}
          {busy && (
            <div className="epidemic-verifying" role="status">
              <LoaderCircle className="spin" size={17} />
              <span>Verifying your key with Epidemic Sound…</span>
            </div>
          )}
          <div className="epidemic-key-help-actions">
            {busy ? (
              <button
                type="button"
                className="button secondary"
                onClick={cancelVerification}
              >
                Cancel verification
              </button>
            ) : (
              <button
                type="button"
                className="text-button"
                onClick={() => void window.studio.openExternal("epidemic-key")}
              >
                Where do I find my key?
                <ExternalLink size={12} />
              </button>
            )}
            <button
              className="button primary"
              type="submit"
              disabled={busy || !key.trim()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <ShieldCheck size={15} />
              )}
              {busy ? "Verifying…" : "Verify and save key"}
            </button>
          </div>
        </form>
      )}
      {onCancel && !busy && !verified && (
        <button className="text-button epidemic-key-cancel" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

export function EpidemicKeyDialog({
  onClose,
  onConnected,
  onBusyChange,
  replace,
}: {
  onClose: () => void;
  onConnected: (status: EpidemicConnection) => void;
  onBusyChange?: (busy: boolean) => void;
  replace?: boolean;
}) {
  const modal = useRef<HTMLElement>(null);
  useEpidemicDialogFocus(modal, true, onClose);
  return (
    <div className="modal-backdrop epidemic-backdrop">
      <section
        ref={modal}
        className="modal epidemic-key-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="epidemic-key-title"
      >
        <header>
          <div className="epidemic-brand">
            <Music2 size={21} />
            <h2 id="epidemic-key-title">Epidemic Sound</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close Epidemic Sound connection"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <EpidemicKeyForm
          onConnected={onConnected}
          onCancel={onClose}
          onBusyChange={onBusyChange}
          replace={replace}
        />
      </section>
    </div>
  );
}

export function EpidemicSettings({
  disabled = false,
  onBusyChange,
}: {
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState<EpidemicConnection | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void window.studio
        .epidemicStatus()
        .then((value) => {
          if (live) setStatus(value);
        })
        .catch(() => {
          if (live) setError("Could not read the Epidemic Sound connection.");
        });
    };
    refresh();
    window.addEventListener("epidemic-connection-changed", refresh);
    return () => {
      live = false;
      window.removeEventListener("epidemic-connection-changed", refresh);
    };
  }, []);
  const remove = async () => {
    setError("");
    try {
      await window.studio.epidemicDisconnect();
      setStatus(await window.studio.epidemicStatus());
      setRemoving(false);
      window.dispatchEvent(new Event("epidemic-connection-changed"));
    } catch {
      setError("Could not remove the connection. Try again.");
    }
  };
  return (
    <div className="setting-section epidemic-settings">
      <div className="section-heading">
        <h3>
          <Music2 size={16} />
          Epidemic Sound
        </h3>
        {status?.connected && (
          <span className="epidemic-connected-badge">
            <Check size={12} />
            Connected
          </span>
        )}
      </div>
      {editing ? (
        <EpidemicKeyForm
          replace={Boolean(status?.connected)}
          onBusyChange={(value) => {
            setKeyBusy(value);
            onBusyChange?.(value);
          }}
          onConnected={(value) => {
            setStatus(value);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <p>
            Browse music and sound effects inside your mix, with inline
            listening and high-quality imports.
          </p>
          <div className="epidemic-settings-status">
            <span className={`dot ${status?.connected ? "green" : "gray"}`} />
            <span>
              {status === null
                ? "Checking connection…"
                : status.connected
                  ? `Key verified${status.verifiedAt ? ` · ${new Date(status.verifiedAt).toLocaleDateString()}` : ""}`
                  : "No API key connected"}
            </span>
          </div>
          {status?.connected && !status.secureStorage && (
            <p className="epidemic-subtle">
              Connected for this session. Secure storage is unavailable on this
              Mac.
            </p>
          )}
          <div className="epidemic-settings-actions">
            <button
              className="button secondary"
              disabled={disabled || !status}
              onClick={() => setEditing(true)}
            >
              <KeyRound size={14} />
              {status?.connected ? "Replace API key" : "Connect API key"}
            </button>
            {status?.connected && (
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => setRemoving(true)}
              >
                Remove key
              </button>
            )}
            <button
              className="text-button"
              onClick={() => void window.studio.openExternal("epidemic-docs")}
            >
              Setup guide
              <ExternalLink size={12} />
            </button>
          </div>
        </>
      )}
      {removing && (
        <div className="epidemic-remove-confirm">
          <p>
            Remove the saved key from this Mac? Imported audio stays in your
            projects.
          </p>
          <button
            className="button secondary"
            onClick={() => setRemoving(false)}
          >
            Keep connection
          </button>
          <button className="button secondary" onClick={() => void remove()}>
            Remove saved key
          </button>
        </div>
      )}
      {keyBusy && (
        <span className="epidemic-subtle">
          You can cancel verification above.
        </span>
      )}
      {error && (
        <div className="epidemic-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
