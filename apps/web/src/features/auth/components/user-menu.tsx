'use client';

import { LoaderCircle, LogOut, Settings, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';

import { useAuth } from '../auth-context';

/** Up to two initials from the display name, e.g. "Asha Rao" → "AR"; empty when none fit. */
export function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

/**
 * Account menu in the app header: who is signed in, a way to their settings, and sign-out.
 * Shows a placeholder while the session is being checked; it never invents an identity.
 */
export function UserMenu(): ReactNode {
  const { state, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  if (state.status !== 'authenticated') {
    return (
      <span className="grid size-10 place-items-center" aria-hidden="true">
        <Skeleton className="size-8 rounded-full bg-muted" />
      </span>
    );
  }

  const { user } = state.session;
  const initials = getInitials(user.name);

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      // On success the auth state changes and the app shell sends the user to the sign-in page.
      await signOut();
    } catch {
      setSignOutFailed(true);
      setSigningOut(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${user.name}`}
        className="rounded-full p-1 transition-colors hover:bg-muted data-[state=open]:bg-muted"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">
            {initials === '' ? <UserRound aria-hidden="true" className="size-4" /> : initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{user.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden="true" />
            Profile and settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault(); // Keep the menu open to show progress or failure.
            void handleSignOut();
          }}
        >
          {signingOut ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <LogOut aria-hidden="true" />
          )}
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
        {signOutFailed && (
          <p role="alert" className="px-2 pt-1 pb-2 text-xs text-expense">
            Could not sign out. Check your connection and try again.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
