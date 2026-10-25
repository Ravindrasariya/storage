import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SaudaSummary } from "@/components/FarmerLotGroup";

interface SaudaEntryProps {
  entry: SaudaSummary;
  canDelete: boolean;
}

export function SaudaInitials({ entry }: { entry: SaudaSummary }) {
  return (
    <span
      className="inline-flex max-w-full items-center rounded border border-sky-700/25 bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-sky-900 dark:border-sky-300/25 dark:bg-sky-950/70 dark:text-sky-100"
      data-testid={`sauda-entry-${entry.id}`}
    >
      <span
        className="max-w-[4rem] truncate"
        title={`${entry.buyerName} · ${entry.quantity} bags`}
        aria-label={`${entry.buyerInitials || "Sauda"} — ${entry.buyerName}, ${entry.quantity} bags`}
        data-testid={`sauda-initials-${entry.id}`}
      >
        {(entry.buyerInitials ?? "").trim() || "\u00a0"}
      </span>
    </span>
  );
}

export function SaudaDeleteButton({ entry, canDelete }: SaudaEntryProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { toast } = useToast();
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "DELETE",
        `/api/lots/${encodeURIComponent(entry.lotId)}/sauda/${encodeURIComponent(entry.id)}`,
      );
      return response.json() as Promise<{ success: true }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/sauda"] });
      toast({ title: "Sauda deleted", description: `${entry.buyerName} · ${entry.quantity} bags` });
      setConfirmOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Could not delete Sauda", description: error.message, variant: "destructive" });
    },
  });

  return (
    <>
        {canDelete && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 shrink-0 text-sky-900 hover:bg-sky-100 hover:text-destructive dark:text-sky-100 dark:hover:bg-sky-900"
            aria-label={`Delete Sauda for ${entry.buyerName}, ${entry.quantity} bags`}
            title={`Delete ${entry.buyerName} · ${entry.quantity} bags`}
            data-testid={`button-delete-sauda-${entry.id}`}
            onClick={(event) => {
              event.stopPropagation();
              setConfirmOpen(true);
            }}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      {canDelete && (
        <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!deleteMutation.isPending) setConfirmOpen(open); }}>
          <AlertDialogContent data-testid={`dialog-confirm-delete-sauda-${entry.id}`} onClick={event => event.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure you want to delete this Sauda?</AlertDialogTitle>
              <AlertDialogDescription>
                Delete the entry for <strong>{entry.buyerName}</strong> — <strong>{entry.quantity} bags</strong>? This removes only this Sauda.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending} data-testid={`button-cancel-delete-sauda-${entry.id}`}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteMutation.isPending}
                data-testid={`button-confirm-delete-sauda-${entry.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  if (!deleteMutation.isPending) deleteMutation.mutate();
                }}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
