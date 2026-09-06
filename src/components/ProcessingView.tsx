import React from 'react';
import {
  Users,
  CheckCircle2,
  PhoneCall,
  Flame,
  SunMedium,
  Leaf,
  Building,
  Activity,
  ArrowRight,
  ShieldCheck,
  Cpu,
} from 'lucide-react';
import { GFBuyerLead } from '../types/buyerLead';
import { WORKFLOW_PIPELINE_ORDER } from '../types/workflow';

interface ProcessingViewProps {
  leads: GFBuyerLead[];
  onSelectLead: (leadId: string) => void;
}

export const ProcessingView: React.FC<ProcessingViewProps> = ({
  leads,
  onSelectLead,
}) => {
  // Aggregate Metrics according to Spec Section 14
  const totalLeads = leads.length;
  const resolved = leads.filter((l) => l.workflow.status !== 'RAW' && l.workflow.status !== 'INVALID_CONTACT').length;
  const enriched = leads.filter((l) => 
    ['ENRICHED', 'CALL_ELIGIBILITY', 'CALL_PENDING', 'CALLING', 'CONNECTED', 'QUALIFICATION_IN_PROGRESS', 'QUALIFIED', 'SCORED', 'HOT', 'WARM', 'NURTURE', 'PROJECT_MATCHED', 'HANDOFF'].includes(l.workflow.status)
  ).length;
  const callsAttempted = leads.filter((l) => 
    ['CALLING', 'CONNECTED', 'QUALIFICATION_IN_PROGRESS', 'QUALIFIED', 'SCORED', 'HOT', 'WARM', 'NURTURE', 'PROJECT_MATCHED', 'HANDOFF', 'CALL_FAILED', 'NO_ANSWER'].includes(l.workflow.status)
  ).length;
  const connected = leads.filter((l) => 
    ['CONNECTED', 'QUALIFICATION_IN_PROGRESS', 'QUALIFIED', 'SCORED', 'HOT', 'WARM', 'NURTURE', 'PROJECT_MATCHED', 'HANDOFF'].includes(l.workflow.status)
  ).length;
  const qualified = leads.filter((l) => 
    ['QUALIFIED', 'SCORED', 'HOT', 'WARM', 'NURTURE', 'PROJECT_MATCHED', 'HANDOFF'].includes(l.workflow.status)
  ).length;
  const hot = leads.filter((l) => l.lead_intelligence.qualification === 'HOT' || l.workflow.status === 'HOT').length;
  const warm = leads.filter((l) => l.lead_intelligence.qualification === 'WARM' || l.workflow.status === 'WARM').length;
  const nurture = leads.filter((l) => l.lead_intelligence.qualification === 'NURTURE' || l.workflow.status === 'NURTURE').length;
  const projectMatches = leads.filter((l) => l.project_intelligence.top_matches.length > 0).length;

  const metricCards = [
    { label: 'Total Leads', value: totalLeads, icon: Users, color: 'text-slate-900', bg: 'bg-slate-50' },
    { label: 'Resolved', value: resolved, icon: CheckCircle2, color: 'text-slate-700', bg: 'bg-slate-50' },
    { label: 'Enriched', value: enriched, icon: Cpu, color: 'text-amber-700', bg: 'bg-amber-50/60' },
    { label: 'Calls Attempted', value: callsAttempted, icon: PhoneCall, color: 'text-blue-700', bg: 'bg-blue-50/60' },
    { label: 'Connected', value: connected, icon: PhoneCall, color: 'text-indigo-700', bg: 'bg-indigo-50/60' },
    { label: 'Qualified', value: qualified, icon: ShieldCheck, color: 'text-emerald-700', bg: 'bg-emerald-50/60' },
    { label: 'HOT', value: hot, icon: Flame, color: 'text-rose-700', bg: 'bg-rose-50/60' },
    { label: 'WARM', value: warm, icon: SunMedium, color: 'text-amber-700', bg: 'bg-amber-50/60' },
    { label: 'NURTURE', value: nurture, icon: Leaf, color: 'text-blue-700', bg: 'bg-blue-50/60' },
    { label: 'Project Matches', value: projectMatches, icon: Building, color: 'text-purple-700', bg: 'bg-purple-50/60' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Title */}
      <div className="space-y-1">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
          <Activity className="w-3.5 h-3.5 text-indigo-600" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Pipeline Telemetry & Stage Funnel</span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Processing Status
        </h2>
        <p className="text-sm text-slate-600 max-w-3xl">
          Autonomous pipeline execution metrics tracking leads across resolution, enrichment, calling, qualification, scoring, and inventory matching.
        </p>
      </div>

      {/* Metric Cards Grid - Exact 10 metrics from spec */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {metricCards.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.label}
              className="p-4 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-2xs hover:shadow-xs transition-shadow"
            >
              <div className="flex items-center justify-between text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-2">
                <span className="truncate">{m.label}</span>
                <div className="p-1 rounded bg-slate-100 text-slate-700">
                  <Icon className="w-3.5 h-3.5 text-slate-700" />
                </div>
              </div>
              <div className="text-2xl font-bold tracking-tight text-slate-900">
                {m.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Pipeline Funnel Stages */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">
              Module Hierarchy
            </span>
            <span className="text-slate-300">|</span>
            <h3 className="text-sm font-semibold text-slate-900">
              Workflow State Machine Progression (14-Stage Canonical Pipeline)
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-500">
            Authoritative Transitions
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {WORKFLOW_PIPELINE_ORDER.map((stage, idx) => {
            const count = leads.filter((l) => l.workflow.status === stage).length;
            const hasLeads = count > 0;
            return (
              <div
                key={stage}
                className={`p-3 rounded border text-center transition-all ${
                  hasLeads
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-950 font-medium shadow-2xs'
                    : 'border-slate-200 bg-slate-50/60 text-slate-600'
                }`}
              >
                <div className={`text-[9px] font-mono font-bold tracking-wider mb-1 ${hasLeads ? 'text-indigo-600' : 'text-slate-400'}`}>
                  STAGE {String(idx + 1).padStart(2, '0')}
                </div>
                <div className="text-xs font-semibold truncate mb-1.5" title={stage}>
                  {stage.replace(/_/g, ' ')}
                </div>
                <div className={`text-base font-bold font-mono ${hasLeads ? 'text-indigo-700' : 'text-slate-500'}`}>
                  {count}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Leads Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Pipeline Queue & Recent Lead Events
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            Click any lead to inspect canonical facts
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-semibold text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-4">Lead ID</th>
                <th className="py-2.5 px-4">Candidate</th>
                <th className="py-2.5 px-4">Current Workflow Stage</th>
                <th className="py-2.5 px-4">Last Event Log</th>
                <th className="py-2.5 px-4">Score</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((lead) => (
                <tr
                  key={lead.lead_id}
                  onClick={() => onSelectLead(lead.lead_id)}
                  className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                >
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                    {lead.lead_id}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">
                      {lead.identity.full_name || 'Anonymous Lead'}
                    </div>
                    <div className="text-slate-500 text-[11px] font-mono">
                      {lead.identity.phone || lead.identity.email || 'No contact info'}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] font-semibold bg-slate-100 text-slate-800 border border-slate-200">
                      {lead.workflow.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                    {lead.workflow.last_event || '—'}
                  </td>
                  <td className="py-3 px-4 font-bold text-slate-900 font-mono">
                    {lead.lead_intelligence.intent_score > 0
                      ? `${lead.lead_intelligence.intent_score}/100`
                      : '—'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectLead(lead.lead_id);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                    >
                      <span>INSPECT</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
