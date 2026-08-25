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
  deleteSearchApiKey,
  isPlausibleApiKey,
  maskApiKey,
  saveApiKey,
  saveSearchApiKey,
} from "@/lib/api-key-store";
import { verifyApiKey } from "@/lib/optimize";

type Props = {
  apiKey: string;
  onChange: (key: string) => void;
  searchApiKey: string;
  onSearchChange: (key: string) => void;
};

export function ApiKeyDialog({
  apiKey,
  onChange,
  searchApiKey,
  onSearchChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draftGemini, setDraftGemini] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [showGemini, setShowGemini] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<"gemini" | "search" | null>(null);

  const geminiSaved = Boolean(apiKey);
  const searchSaved = Boolean(searchApiKey);

  function handleOpen(next: boolean) {
    setOpen(next);
    if (next) {
      setDraftGemini("");
      setDraftSearch("");
      setShowGemini(false);
      setShowSearch(false);
    }
  }

  function onSaveGemini() {
    const next = draftGemini.trim();
    if (!isPlausibleApiKey(next)) {
      toast.error("Gemini key does not look valid.");
      return;
    }
    saveApiKey(next);
    onChange(next);
    toast.success(geminiSaved ? "Gemini key replaced." : "Gemini key saved.");
    setDraftGemini("");
  }

  function onSaveSearch() {
    const next = draftSearch.trim();
    if (!isPlausibleApiKey(next)) {
      toast.error("Serper key does not look valid.");
      return;
    }
    saveSearchApiKey(next);
    onSearchChange(next);
    toast.success(searchSaved ? "Serper key replaced." : "Serper key saved.");
    setDraftSearch("");
  }

  async function onVerifyGemini() {
    const next = draftGemini.trim() || apiKey;
    if (!isPlausibleApiKey(next)) {
      toast.error("Enter a Gemini key first.");
      return;
    }
    setBusy(true);
    try {
      const result = await verifyApiKey({ data: { apiKey: next } });
      if (result.ok) {
        saveApiKey(next);
        onChange(next);
        toast.success("Gemini key verified.");
        setDraftGemini("");
      } else {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not verify the Gemini key.");
    } finally {
      setBusy(false);
    }
  }

  function onDeleteGemini() {
    deleteApiKey();
    onChange("");
    setDraftGemini("");
    setConfirmDelete(null);
    toast.message("Gemini key removed from this browser.");
  }

  function onDeleteSearch() {
    deleteSearchApiKey();
    onSearchChange("");
    setDraftSearch("");
    setConfirmDelete(null);
    toast.message("Serper key removed from this browser.");
  }

  const bothReady = geminiSaved && searchSaved;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-9 gap-2">
            <KeyRound className="size-3.5" />
            <span className="hidden sm:inline">API keys</span>
            {bothReady ? (
              <Badge variant="secondary" className="hidden text-[10px] sm:inline">2/2</Badge>
            ) : geminiSaved || searchSaved ? (
              <Badge variant="outline" className="hidden text-[10px] sm:inline">1/2</Badge>
            ) : null}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>API keys</DialogTitle>
            <DialogDescription>
              Two keys for the two features. Stored only in this browser — never
              sent to our servers except when calling Gemini or Serper.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-6 py-1">
            <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Gemini key</p>
                  <p className="text-xs text-muted-foreground">
                    Pipeline: keywords, rewrite, grammar, audit
                  </p>
                </div>
                {geminiSaved ? (
                  <Badge variant="secondary" className="text-[10px]">Saved {maskApiKey(apiKey)}</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">Required for Pipeline</Badge>
                )}
              </div>
              <Label htmlFor="gemini-key-input" className="sr-only">Gemini API key</Label>
              <div className="relative">
                <Input
                  id="gemini-key-input"
                  autoComplete="off"
                  spellCheck={false}
                  type={showGemini ? "text" : "password"}
                  value={draftGemini}
                  onChange={(e) => setDraftGemini(e.target.value)}
                  placeholder={geminiSaved ? "Paste to replace…" : "AIza… (AI Studio / Generative Language)"}
                  className="pr-11 font-mono text-sm"
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  onClick={() => setShowGemini((v) => !v)}
                  aria-label={showGemini ? "Hide Gemini key" : "Show Gemini key"}
                >
                  {showGemini ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {geminiSaved ? (
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => setConfirmDelete("gemini")}>
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                ) : null}
                <Button type="button" variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => void onVerifyGemini()}>
                  {busy ? "Checking…" : "Verify"}
                </Button>
                <Button type="button" size="sm" className="h-8" disabled={!draftGemini.trim()} onClick={onSaveGemini}>
                  <Check className="size-3.5" /> {geminiSaved ? "Replace" : "Save"}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Serper (Job Search)</p>
                  <p className="text-xs text-muted-foreground">
                    Job Search: Serper Google results (site:workable.com style)
                  </p>
                </div>
                {searchSaved ? (
                  <Badge variant="secondary" className="text-[10px]">Saved {maskApiKey(searchApiKey)}</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">Optional — improves results</Badge>
                )}
              </div>
              <Label htmlFor="search-key-input" className="sr-only">Serper API key</Label>
              <div className="relative">
                <Input
                  id="search-key-input"
                  autoComplete="off"
                  spellCheck={false}
                  type={showSearch ? "text" : "password"}
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  placeholder={searchSaved ? "Paste to replace…" : "Serper API key from serper.dev"}
                  className="pr-11 font-mono text-sm"
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  onClick={() => setShowSearch((v) => !v)}
                  aria-label={showSearch ? "Hide Serper key" : "Show Serper key"}
                >
                  {showSearch ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {searchSaved ? (
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => setConfirmDelete("search")}>
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                ) : null}
                <Button type="button" size="sm" className="h-8" disabled={!draftSearch.trim()} onClick={onSaveSearch}>
                  <Check className="size-3.5" /> {searchSaved ? "Replace" : "Save"}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Get a free key at{" "}
                <a
                  href="https://serper.dev"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  serper.dev
                </a>{" "}
                (2,500 free queries, no credit card).
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete the {confirmDelete === "search" ? "Serper" : "Gemini"} key?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Removed from this browser only.
              {confirmDelete === "search"
                ? " Job Search will fall back to public web search until you save a Serper key again."
                : " The pipeline will not run until you save a Gemini key again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep key</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => (confirmDelete === "search" ? onDeleteSearch() : onDeleteGemini())}
            >
              Delete key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
