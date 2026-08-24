import { useState } from "react";
import { KeyRound, Check, Trash2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  deleteApiKey,
  isPlausibleApiKey,
  maskApiKey,
  saveApiKey,
} from "@/lib/api-key-store";
import { verifyApiKey } from "@/lib/optimize";

type Props = {
  apiKey: string;
  onChange: (key: string) => void;
};

export function ApiKeyDialog({ apiKey, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saved = Boolean(apiKey);

  function handleOpen(next: boolean) {
    setOpen(next);
    if (next) {
      setDraft("");
      setShow(false);
    }
  }

  function persist(next: string) {
    if (!isPlausibleApiKey(next)) {
      toast.error("That does not look like an API key.");
      return false;
    }
    saveApiKey(next);
    onChange(next.trim());
    return true;
  }

  async function onSave() {
    const next = draft.trim();
    if (!persist(next)) return;
    toast.success(saved ? "API key replaced." : "API key saved in this browser.");
    setOpen(false);
  }

  async function onVerify() {
    const next = draft.trim() || apiKey;
    if (!isPlausibleApiKey(next)) {
      toast.error("Enter an API key first.");
      return;
    }
    setBusy(true);
    try {
      const result = await verifyApiKey({ data: { apiKey: next } });
      if (result.ok) {
        persist(next);
        toast.success("Key verified.");
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not verify the key.");
    } finally {
      setBusy(false);
    }
  }

  function onDelete() {
    deleteApiKey();
    onChange("");
    setDraft("");
    setConfirmDelete(false);
    setOpen(false);
    toast.success("API key deleted from this browser.");
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <KeyRound className="size-3.5" />
            <span className="hidden sm:inline">{saved ? "API key" : "Add API key"}</span>
            <Badge variant={saved ? "success" : "outline"} className="font-mono">
              {saved ? maskApiKey(apiKey) : "required"}
            </Badge>
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Google AI Studio API key</DialogTitle>
            <DialogDescription>
              Get a free key at{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                aistudio.google.com/apikey
              </a>
              . Stored only in this browser. Sent with each run, never written on
              the server. You can save, replace, or delete it at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {saved ? (
              <p className="text-sm text-muted-foreground">
                Saved key:{" "}
                <span className="font-mono text-foreground">{maskApiKey(apiKey)}</span>
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="api-key-input">
                {saved ? "Replace with a new key" : "Paste your key"}
              </Label>
              <div className="relative">
                <Input
                  id="api-key-input"
                  autoComplete="off"
                  spellCheck={false}
                  type={show ? "text" : "password"}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="AIza…"
                  className="pr-11 font-mono"
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? "Hide key" : "Show key"}
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            {saved ? (
              <Button
                type="button"
                variant="destructive"
                className="sm:mr-auto"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onVerify} disabled={busy}>
              {busy ? "Checking…" : "Verify"}
            </Button>
            <Button type="button" onClick={onSave} disabled={busy || !draft.trim()}>
              <Check className="size-4" />
              {saved ? "Replace" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the saved key?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from this browser only. The pipeline cannot run until
              you save a key again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep key</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onDelete}
            >
              Delete key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
