import { useEffect, useRef, useState } from 'react';
import { money0 } from '../lib/format';

type Formatter = (n: number | null | undefined) => string;

// A whole-dollar figure that briefly pulses when its displayed value changes in
// place. Used for the transmute build-cost cells so re-pricing — flipping the
// "Recent prices" toggle — visibly ripples through exactly the numbers it moved,
// and only those: a recipe with no recent-season sales keeps its number and stays
// quiet. The first render never pulses (there is no prior value to differ from);
// the pulse is a CSS animation (.money.changed in App.css) disabled under
// prefers-reduced-motion.
export function Money({ value, format = money0 }: { value: number | null | undefined; format?: Formatter }) {
  const text = format(value);
  const prev = useRef(text);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (prev.current === text) return;
    prev.current = text;
    setChanged(true);
    const t = setTimeout(() => setChanged(false), 1300);
    return () => clearTimeout(t);
  }, [text]);

  return <span className={changed ? 'money changed' : 'money'}>{text}</span>;
}
