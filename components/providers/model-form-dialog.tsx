"use client"

import * as React from "react"

import type { ModelDTO } from "@/lib/schemas/model"

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"

import { ModelForm } from "./model-form"

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    mode: "create" | "edit"
    /** In create mode: optional seed (e.g. a discovered model being
     *  promoted). In edit mode: the row being edited. */
    model?: ModelDTO | null
    defaultProviderId?: string
}

export function ModelFormDialog({ open, onOpenChange, mode, model, defaultProviderId }: Props) {
    // Pure create only when no model is supplied. Promoting a discovered
    // model is a form of edit from the user's POV — show the same title.
    const title = model || mode === "edit" ? "Edit" : "Add model"

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto"
                // Whenever the dialog opens against an existing record
                // (edit or discovered-promote) the cursor in the
                // display-name field is surprising. Only pure-add lets
                // the default first-focus stand.
                onOpenAutoFocus={model ? (e) => e.preventDefault() : undefined}
            >
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                {/* Remount on open so the form initializer effect re-fires
                 *  with the freshest `model` prop. */}
                {open && (
                    <ModelForm
                        mode={mode}
                        model={model}
                        defaultProviderId={defaultProviderId}
                        onSaved={() => onOpenChange(false)}
                        onCancel={() => onOpenChange(false)}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}
