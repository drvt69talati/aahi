import React, { useState, useEffect, useCallback } from 'react';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
type GateStatus = 'pending' | 'approved' | 'declined';

interface ApprovalGate {
  requestId: string;
  action: string;
  integration: string;
  riskLevel: RiskLevel;
  params: Record<string, unknown>;
  timeout?: number; // seconds
}

interface ApprovalGateProps {
  gate: ApprovalGate;
  onApprove: () => void;
  onDecline: () => void;
}

const riskColors: Record<RiskLevel, string> = {
  low: '#4ec9b0',
  medium: '#dcdcaa',
  high: '#ce9178',
  critical: '#f44747',
};

const riskLabels: Record<RiskLevel, string> = {
  low: 'Low Risk',
  medium: 'Medium Risk',
  high: 'High Risk',
  critical: 'Critical Risk',
};

const styles = {
  card: {
    backgroundColor: '#2d2d2d',
    border: '1px solid #3e3e42',
    borderRadius: 6,
    padding: 16,
    margin: '8px 0',
    maxWidth: 420,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: '#cccccc',
  },
  riskBadge: {
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    fontSize: 13,
  },
  label: {
    color: '#858585',
    minWidth: 80,
  },
  value: {
    color: '#cccccc',
  },
  paramsBox: {
    backgroundColor: '#1e1e1e',
    borderRadius: 4,
    padding: 10,
    marginTop: 8,
    marginBottom: 12,
    fontSize: 12,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    color: '#cccccc',
    maxHeight: 120,
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  approveBtn: {
    padding: '6px 16px',
    backgroundColor: '#4ec9b0',
    color: '#1e1e1e',
    border: 'none',
    borderRadius: 4,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  declineBtn: {
    padding: '6px 16px',
    backgroundColor: 'transparent',
    color: '#f44747',
    border: '1px solid #f44747',
    borderRadius: 4,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  viewParamsBtn: {
    padding: '6px 12px',
    backgroundColor: 'transparent',
    color: '#858585',
    border: '1px solid #3e3e42',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginLeft: 'auto',
  },
  confirmInput: {
    width: '100%',
    padding: '6px 10px',
    backgroundColor: '#1e1e1e',
    border: '1px solid #f44747',
    borderRadius: 4,
    color: '#cccccc',
    fontSize: 13,
    fontFamily: 'inherit',
    marginTop: 8,
    outline: 'none',
  },
  confirmHint: {
    fontSize: 11,
    color: '#f44747',
    marginTop: 4,
  },
  timer: {
    fontSize: 11,
    color: '#cca700',
    marginLeft: 8,
  },
  resolvedBanner: {
    padding: '8px 12px',
    borderRadius: 4,
    fontSize: 13,
    fontWeight: 600 as const,
    textAlign: 'center' as const,
    marginTop: 8,
  },
};

export const ApprovalGateCard: React.FC<ApprovalGateProps> = ({
  gate,
  onApprove,
  onDecline,
}) => {
  const [showParams, setShowParams] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [status, setStatus] = useState<GateStatus>('pending');
  const [secondsLeft, setSecondsLeft] = useState<number | null>(
    gate.timeout ?? null
  );

  const isCritical = gate.riskLevel === 'critical';
  const confirmPhrase = 'CONFIRM';
  const canApprove = isCritical ? confirmText === confirmPhrase : true;

  // Countdown timer
  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0 || status !== 'pending') return;

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          // Auto-decline on timeout
          setStatus('declined');
          onDecline();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [secondsLeft, status, onDecline]);

  const handleApprove = useCallback(() => {
    if (!canApprove || status !== 'pending') return;
    setStatus('approved');
    onApprove();
  }, [canApprove, status, onApprove]);

  const handleDecline = useCallback(() => {
    if (status !== 'pending') return;
    setStatus('declined');
    onDecline();
  }, [status, onDecline]);

  return (
    <div
      style={{
        ...styles.card,
        borderLeft: `3px solid ${riskColors[gate.riskLevel]}`,
        opacity: status !== 'pending' ? 0.7 : 1,
      }}
    >
      <div style={styles.header}>
        <div style={styles.title}>Approval Required</div>
        <span
          style={{
            ...styles.riskBadge,
            backgroundColor: riskColors[gate.riskLevel] + '22',
            color: riskColors[gate.riskLevel],
          }}
        >
          {riskLabels[gate.riskLevel]}
        </span>
      </div>

      <div style={styles.row}>
        <span style={styles.label}>Action:</span>
        <span style={styles.value}>{gate.action}</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Integration:</span>
        <span style={styles.value}>{gate.integration}</span>
      </div>

      {showParams && (
        <div style={styles.paramsBox}>{JSON.stringify(gate.params, null, 2)}</div>
      )}

      {status === 'pending' && (
        <>
          {isCritical && (
            <>
              <div style={styles.confirmHint}>
                Type "{confirmPhrase}" to approve this critical action
              </div>
              <input
                style={styles.confirmInput}
                placeholder={`Type ${confirmPhrase} to continue`}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
              />
            </>
          )}

          <div style={styles.actions}>
            <button
              style={{
                ...styles.approveBtn,
                opacity: canApprove ? 1 : 0.4,
                cursor: canApprove ? 'pointer' : 'not-allowed',
              }}
              onClick={handleApprove}
              disabled={!canApprove}
            >
              Approve
            </button>
            <button style={styles.declineBtn} onClick={handleDecline}>
              Decline
            </button>
            <button
              style={styles.viewParamsBtn}
              onClick={() => setShowParams(!showParams)}
            >
              {showParams ? 'Hide' : 'View'} Params
            </button>
            {secondsLeft !== null && secondsLeft > 0 && (
              <span style={styles.timer}>
                {secondsLeft}s remaining
              </span>
            )}
          </div>
        </>
      )}

      {status === 'approved' && (
        <div
          style={{
            ...styles.resolvedBanner,
            backgroundColor: '#4ec9b022',
            color: '#4ec9b0',
            border: '1px solid #4ec9b044',
          }}
        >
          {'\u2713'} Approved
        </div>
      )}

      {status === 'declined' && (
        <div
          style={{
            ...styles.resolvedBanner,
            backgroundColor: '#f4474722',
            color: '#f44747',
            border: '1px solid #f4474744',
          }}
        >
          {'\u2717'} Declined
        </div>
      )}
    </div>
  );
};
