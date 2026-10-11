import { STATUS_HELP } from '../constants';

export const StatusBadge = ({ status }) => (
  <span className={`badge st st-${status.replace(/\s+/g, '-')}`} title={STATUS_HELP[status]}>{status}</span>
);

export const PriorityBadge = ({ priority }) => (
  <span className={`badge pr-${priority}`}><span className="visually-hidden">Priority: </span>{priority}</span>
);

/** Honest provenance label for anything an agent produced. */
export const SourceTag = ({ source, model }) => (
  source === 'anthropic'
    ? <span className="badge tag-ai" title={model ? `Model: ${model}` : undefined}>AI suggestion</span>
    : <span className="badge tag-fallback">Rule-based, not AI</span>
);
