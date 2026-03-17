import React, { useState } from 'react';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface ApprovalGateProps {
  action: string;
  integration: string;
  riskLevel: RiskLevel;
  params: Record<string, unknown>;
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
};

export const ApprovalGateCard: React.FC<ApprovalGateProps> = ({
  action,
  integration,
  riskLevel,
  params,
  onApprove,
  onDecline,
}) => {
  const [showParams, setShowParams] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const isCritical = riskLevel === 'critical';
  const confirmPhrase = 'CONFIRM';
  const canApprove = isCritical ? confirmText === confirmPhrase : true;

  return (
    <div
      style={{
        ...styles.card,
        borderLeft: `3px solid ${riskColors[riskLevel]}`,
      }}
    >
      <div style={styles.header}>
        <div style={styles.title}>Approval Required</div>
        <span
          style={{
            ...styles.riskBadge,
            backgroundColor: riskColors[riskLevel] + '22',
            color: riskColors[riskLevel],
          }}
        >
          {riskLabels[riskLevel]}
        </span>
      </div>

      <div style={styles.row}>
        <span style={styles.label}>Action:</span>
        <span style={styles.value}>{action}</span>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Integration:</span>
        <span style={styles.value}>{integration}</span>
      </div>

      {showParams && (
        <div style={styles.paramsBox}>{JSON.stringify(params, null, 2)}</div>
      )}

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
          onClick={canApprove ? onApprove : undefined}
          disabled={!canApprove}
        >
          Approve
        </button>
        <button style={styles.declineBtn} onClick={onDecline}>
          Decline
        </button>
        <button
          style={styles.viewParamsBtn}
          onClick={() => setShowParams(!showParams)}
        >
          {showParams ? 'Hide' : 'View'} Params
        </button>
      </div>
    </div>
  );
};
