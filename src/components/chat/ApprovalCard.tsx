import React from 'react';
import type { PendingApprovalInfo } from '@/types/chat';

interface ApprovalCardProps {
  pending: PendingApprovalInfo;
  onDecision: (decision: 'approve' | 'reject') => void;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ pending, onDecision }) => {
  return (
    <div className="mt-2 p-2 border rounded bg-muted">
      <p className="text-sm font-medium">{pending.summary}</p>
      <div className="mt-1 flex gap-2">
        <button
          className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded"
          onClick={() => onDecision('approve')}
        >
          Approve
        </button>
        <button
          className="px-3 py-1 text-sm bg-destructive text-destructive-foreground rounded"
          onClick={() => onDecision('reject')}
        >
          Reject
        </button>
      </div>
    </div>
  );
};
