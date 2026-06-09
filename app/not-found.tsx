import Link from "next/link"
import { Button } from "@/components/ui/button"

/**
 * Top-level 404 page. Matches the dashboard error.tsx look so the
 * out-of-app experience stays consistent. Triggered for unmatched
 * paths after auth-context resolves.
 */
export default function NotFound() {
    return (
        <div className="flex h-screen w-full items-center justify-center p-6 bg-background">
            <div className="max-w-md w-full space-y-4 text-center">
                <h1 className="text-6xl font-semibold text-muted-foreground/40">
                    404
                </h1>
                <h2 className="text-lg font-semibold text-foreground">
                    Page not found
                </h2>
                <p className="text-sm text-muted-foreground">
                    The page you&apos;re looking for doesn&apos;t exist or has been moved.
                </p>
                <div className="pt-2">
                    <Button asChild>
                        <Link href="/">Back to dashboard</Link>
                    </Button>
                </div>
            </div>
        </div>
    )
}
