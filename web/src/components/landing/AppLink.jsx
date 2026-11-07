import { Link } from "react-router-dom";

import { RUN_IT, STATIC_SITE } from "../../lib/site.js";

/**
 * The way into the app. On the static copy there is no app to go into, so it says
 * so, and points at how to run AskOnly instead.
 */
export default function AppLink({ icon = null, ...props }) {
  if (STATIC_SITE) {
    return (
      <a href={RUN_IT} target="_blank" rel="noreferrer" {...props}>
        {icon}
        Run it yourself
      </a>
    );
  }
  return (
    <Link to="/documents" {...props}>
      {icon}
      Seal a document
    </Link>
  );
}
