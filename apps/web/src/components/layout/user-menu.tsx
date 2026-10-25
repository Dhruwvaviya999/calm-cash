'use client';

import { LogIn, Settings, UserRound } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Profile placeholder until authentication exists (Phase 3). It is honest about the state:
 * nobody is signed in, and sign-in is shown as unavailable rather than as a working action.
 */
export function UserMenu(): ReactNode {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="rounded-full p-1 transition-colors hover:bg-muted data-[state=open]:bg-muted"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-accent text-accent-foreground">
            <UserRound aria-hidden="true" className="size-4" />
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-medium">Guest preview</span>
          <span className="text-xs font-normal text-muted-foreground">You are not signed in.</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <LogIn aria-hidden="true" />
          Sign in
          <span className="ml-auto text-xs text-muted-foreground">Coming soon</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
