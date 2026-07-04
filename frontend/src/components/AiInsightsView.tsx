import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brain, RotateCw, Loader2, AlertCircle } from 'lucide-react';

interface AiInsightsViewProps {
  token: string;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const AiInsightsView: React.FC<AiInsightsViewProps> = ({ token, showToast }) => {
  
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['aiInsights', token],
    queryFn: async () => {
      const res = await fetch('/api/ai/insights', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "AI Insights temporarily unavailable");
      }
      return res.json();
    },
    enabled: false // Only fetch manually on load/refresh
  });

  const triggerFetch = () => {
    showToast("Analyzing employee burnout and leave clashing...", "info");
    refetch();
  };

  // Simple parser to convert Llama Markdown to safe HTML elements
  const formatMarkdown = (markdown: string) => {
    let text = markdown;
    text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");
    text = text.replace(/-\s(.*)/g, "<li>$1</li>");
    text = text.replace(/(<li>.*?<\/li>)/gs, "<ul>$1</ul>");
    text = text.replace(/<\/ul>\s*<ul>/g, ""); // Collapse adjacent lists
    text = text.replace(/\n/g, "<br>");
    return { __html: text };
  };

  return (
    <div className="card glass ai-glow-card">
      <div className="card-header flex-between" style={{ borderBottom: 'none' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Brain size={18} style={{ color: 'var(--accent)' }} /> Llama 3.1 AI HR Director
        </h3>
        <button 
          className="btn btn-sm btn-ai" 
          disabled={isLoading || isFetching} 
          onClick={triggerFetch}
        >
          <RotateCw size={12} className={isFetching ? "fa-spin" : ""} /> 
          {isFetching ? "Analyzing..." : "Refresh Analysis"}
        </button>
      </div>
      <div className="card-body">
        <div className="ai-insight-panel">
          <div className="ai-model-meta">
            <span className="badge badge-purple">
              <Brain size={12} style={{ marginRight: '4px' }} /> llama-3.1-8b-instant
            </span>
            <span className="ai-time">
              {data?.generated_at ? `Analyzed: ${new Date(data.generated_at).toLocaleString()}` : "Never analyzed"}
            </span>
          </div>

          <div className="ai-output">
            {isLoading || isFetching ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
                <Loader2 className="spinner" size={18} />
                <span>Querying model...</span>
              </div>
            ) : error ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)' }}>
                <AlertCircle size={18} />
                <span>{(error as any).message}</span>
              </div>
            ) : data?.summary ? (
              <div dangerouslySetInnerHTML={formatMarkdown(data.summary)} />
            ) : (
              <p className="text-muted">
                Click "Refresh Analysis" to trigger Llama 3.1 burnout and shortage check.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
