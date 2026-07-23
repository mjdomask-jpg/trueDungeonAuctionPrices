import { type ReactNode } from 'react';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';

// A page's opening paragraph, with an optional shorter form for phones. The
// full text explains the page to a first-time reader on a desktop; on a 375px
// screen that same text costs a fifth of the viewport before any data shows, so
// each page supplies a trimmed line instead.
//
// Falls back to the full text when a page hasn't been given a short form yet.
export function PageIntro(
  { short, className = 'sub', children }:
  { short?: ReactNode; className?: string; children: ReactNode },
) {
  const narrow = useMediaQuery(NARROW);
  return <p className={className}>{narrow && short ? short : children}</p>;
}
