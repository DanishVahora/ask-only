import clsx from "clsx";

/**
 * The AskOnly mark: a sheet with one corner gone, blacked out except for the one line
 * the question needed, which has been read in highlighter.
 *
 * Measured off the brand file (docs/brand/askonly-mark-60.png): the sheet is 460 by 620,
 * its corners are rounded 37, the cut takes 101.2 off each side at 45 degrees, and the
 * line is 344 by 80, dead centre. The sheet takes the colour of the text beside it; the
 * line is always the marker. Hovering the link it sits in draws the line again.
 */
export default function Mark({ size = 20, className }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 460 620"
      width={(size * 460) / 620}
      height={size}
      className={clsx("logo-mark", className)}
    >
      <path fill="currentColor" d="M37 0H423A37 37 0 0 1 460 37V518.8L358.8 620H37A37 37 0 0 1 0 583V37A37 37 0 0 1 37 0Z" />
      <path
        className="logo-line"
        d="M98 310H362"
        pathLength="1"
        fill="none"
        stroke="#ffd447"
        strokeWidth="80"
        strokeLinecap="round"
      />
    </svg>
  );
}
