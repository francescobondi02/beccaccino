# UI Primitives (shadcn/ui)

## Overview
Generated shadcn/ui primitives (configured by `frontend/components.json`) built
on Radix UI, `class-variance-authority` and `cn` from `../../lib/utils.ts`. Add
new primitives with the shadcn CLI rather than by hand. Vitest coverage excludes
this directory (`vitest.config.ts`).

## Interface
- `alert-dialog.tsx`: `AlertDialog`, `AlertDialogPortal`, `AlertDialogOverlay`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` [alert-dialog.tsx:AlertDialog]
- `avatar.tsx`: `Avatar`, `AvatarImage`, `AvatarFallback` [avatar.tsx:Avatar]
- `badge.tsx`: `Badge`, `badgeVariants`, `BadgeProps`; variants `default`, `secondary`, `destructive`, `outline` [badge.tsx:badgeVariants]
- `button.tsx`: `Button`, `buttonVariants`, `ButtonProps`; variants `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`, `gradient` (project addition); sizes `default`, `sm`, `lg`, `icon`; `asChild` renders a Radix `Slot` [button.tsx:buttonVariants], [button.tsx:Button]
- `card.tsx`: `Card`, `CardHeader`, `CardFooter`, `CardTitle`, `CardDescription`, `CardContent` [card.tsx:Card]
- `dialog.tsx`: `Dialog`, `DialogPortal`, `DialogOverlay`, `DialogClose`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription` [dialog.tsx:DialogContent]
- `dropdown-menu.tsx`: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuGroup`, `DropdownMenuPortal`, `DropdownMenuSub`, `DropdownMenuSubContent`, `DropdownMenuSubTrigger`, `DropdownMenuRadioGroup` [dropdown-menu.tsx:DropdownMenu]
- `input.tsx`: `Input` [input.tsx:Input]
- `label.tsx`: `Label` [label.tsx:Label]
- `sonner.tsx`: `Toaster` (themed wrapper over `sonner`) and re-exported `toast` [sonner.tsx:Toaster]

## Invariants
- `DialogContent` always renders a close button with the Italian screen-reader label "Chiudi" [dialog.tsx:DialogContent]
- `AlertDialogAction` uses `buttonVariants()`; `AlertDialogCancel` uses the `outline` variant [alert-dialog.tsx:AlertDialogAction], [alert-dialog.tsx:AlertDialogCancel]
- `Toaster` takes its theme from `next-themes` `useTheme()` (default `"system"`) [sonner.tsx:Toaster]

## Side Effects
- None beyond rendering dialog, alert-dialog and dropdown content through Radix `Portal` components [dialog.tsx:DialogContent], [alert-dialog.tsx:AlertDialogContent], [dropdown-menu.tsx:DropdownMenuContent]

## Verification
- No dedicated tests; consumers are covered by the component and page suites.
- Run: `cd frontend && npm run typecheck && npm run lint && npm test`
