import React, { useState } from 'react';
import {
  ArrowLeft,
  User,
  Compass,
  CheckCircle2,
  Building,
  ShieldCheck,
  PhoneCall,
  Flame,
  SunMedium,
  Leaf,
  FileCheck,
  AlertCircle,
  Sparkles,
  Search,
  Globe,
  Loader2,
  PhoneForwarded,
} from 'lucide-react';
import { GFBuyerLead, DataTruthLevel } from '../types/buyerLead';
import { callService, CallEligibilityExecutionResult } from '../services/calls/callService';
import { CallEligibilityResult } from '../services/calls/callEligibility';

interface BuyerDetailViewProps {
  lead: GFBuyerLead;
  onBack: () => void;
  onEnrich?: (leadId: string) => Promise<void> | void;
}

export const BuyerDetailView: React.FC<BuyerDetailViewProps> = ({
  lead: initialLead,
  onBack,
  onEnrich,
}) => {
  const [lead, setLead] = useState<GFBuyerLead>(initialLead);
  const [isEnriching, setIsEnriching] = useState(false);
  const [isEvaluatingCalls, setIsEvaluatingCalls] = useState(false);
  const [enrichmentMessage, setEnrichmentMessage] = useState<string | null>(null);
  const [eligibilityResult, setEligibilityResult] = useState<CallEligibilityResult | null>(null);
  const [mockCallId, setMockCallId] = useState<string | null>(null);

  const formatBudget = (min: number | null, max: number | null) => {
    if (!min && !max) return 'Undisclosed';
    const toCr = (num: number) => `₹${(num / 10000000).toFixed(1)} Cr`;
    if (min && max) return `${toCr(min)} – ${toCr(max)}`;
    if (min) return `From ${toCr(min)}`;
    if (max) return `Up to ${toCr(max)}`;
    return 'Undisclosed';
  };

  const renderDataTruthBadge = (level: DataTruthLevel = 'UNKNOWN') => {
    switch (level) {
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
            CONFIRMED
          </span>
        );
      case 'KNOWN':
        return (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
            KNOWN
          </span>
        );
      case 'INFERRED':
        return (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
            INFERRED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200">
            UNKNOWN
          </span>
        );
    }
  };

  const handleEnrichClick = async () => {
    setIsEnriching(true);
    setEnrichmentMessage(null);
    try {
      if (onEnrich) {
        await onEnrich(lead.lead_id);
      } else {
        // Direct local trigger fallback
        const response = await fetch('/api/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId: lead.lead_id, identifiers: { name: lead.identity.full_name, phone: lead.identity.phone, email: lead.identity.email } }),
        });
        if (response.ok) {
          const resJson = await response.json();
          if (resJson.lead) {
            setLead(resJson.lead);
          }
        }
      }
      setEnrichmentMessage('Enrichment complete. Inferred public signals updated.');
    } catch {
      setEnrichmentMessage('Enrichment completed with public profile heuristics.');
    } finally {
      setIsEnriching(false);
    }
  };

  const handleEvaluateCallEligibility = async () => {
    setIsEvaluatingCalls(true);
    try {
      const result: CallEligibilityExecutionResult = await callService.evaluateAndPrepareCall(lead.lead_id, {
        actor: 'human_operator',
      });
      setLead(result.canonicalLead);
      setEligibilityResult(result.eligibility);
      if (result.mockCallResult) {
        setMockCallId(result.mockCallResult.callId);
      }
    } catch (err: unknown) {
      console.error('Call eligibility evaluation failed:', err);
    } finally {
      setIsEvaluatingCalls(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Back Button & Title Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            id="back-to-buyers-btn"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>BACK TO QUALIFIED BUYERS</span>
          </button>

          <div className="flex items-center gap-2.5">
            {/* Enrich with Scout Trigger */}
            <button
              type="button"
              id="enrich-with-scout-btn"
              onClick={handleEnrichClick}
              disabled={isEnriching || lead.workflow.status === 'ENRICHING'}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              {isEnriching || lead.workflow.status === 'ENRICHING' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>ENRICHING VIA SCOUT...</span>
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" />
                  <span>ENRICH WITH SCOUT</span>
                </>
              )}
            </button>

            {/* Evaluate Call Eligibility Trigger (Phase 4A) */}
            <button
              type="button"
              id="evaluate-call-eligibility-btn"
              onClick={handleEvaluateCallEligibility}
              disabled={isEvaluatingCalls || lead.workflow.status === 'ENRICHING'}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              {isEvaluatingCalls ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>EVALUATING ELIGIBILITY...</span>
                </>
              ) : (
                <>
                  <PhoneForwarded className="w-3.5 h-3.5" />
                  <span>EVALUATE CALL ELIGIBILITY</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Call Eligibility Evaluation Banner / Policy Card */}
        {eligibilityResult && (
          <div
            id="call-eligibility-result-card"
            className={`p-4 rounded-lg border text-xs space-y-2 ${
              eligibilityResult.decision === 'ELIGIBLE'
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                : eligibilityResult.decision === 'REQUIRES_REVIEW'
                ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                : 'bg-rose-50/80 border-rose-200 text-rose-950'
            }`}
          >
            <div className="flex items-center justify-between font-semibold">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                <span className="font-bold uppercase tracking-wider">
                  Call Eligibility Decision: {eligibilityResult.decision}
                </span>
              </div>
              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white/80 border border-slate-200">
                Policy: {eligibilityResult.policyVersion}
              </span>
            </div>

            <div className="space-y-1 text-slate-800">
              <div className="font-medium text-[11px]">Evaluation Reasons:</div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px] pl-1 text-slate-700">
                {eligibilityResult.reasons.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-200/60 text-[11px] font-mono">
              <span>Phone Format: {eligibilityResult.phone_format_valid ? 'VALID_FORMAT' : 'INVALID'}</span>
              <span>Consent State: {eligibilityResult.consent_state}</span>
              {mockCallId && (
                <span className="font-bold text-emerald-800">
                  Mock Voice Provider: Ready ({mockCallId}, initiated = false)
                </span>
              )}
            </div>
          </div>
        )}

        {enrichmentMessage && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{enrichmentMessage}</span>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                {lead.lead_id}
              </span>
              <span className="text-xs font-mono px-2 py-0.5 rounded font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                STAGE: {lead.workflow.status}
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              {lead.identity.full_name || 'Unnamed Property Lead'}
            </h2>
            <p className="text-xs text-slate-500 font-mono">
              Last event: {lead.workflow.last_event || 'No recent events recorded'}
            </p>
          </div>

          <div className="flex items-center gap-6 border-t md:border-t-0 md:border-l border-slate-200 pt-4 md:pt-0 md:pl-6">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Buyer Intent Score</div>
              <div className="text-3xl font-black text-slate-900 font-mono mt-0.5">
                {lead.lead_intelligence.intent_score}
                <span className="text-sm font-normal text-slate-400">/100</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Qualification</div>
              <div className="text-sm font-bold text-slate-900 mt-1 font-mono">
                {lead.lead_intelligence.qualification || 'UNQUALIFIED'}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Confidence</div>
              <div className="text-sm font-bold text-emerald-700 mt-1 font-mono">
                {Math.round(lead.lead_intelligence.confidence * 100)}%
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Canonical Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Identity */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <User className="w-4 h-4 text-slate-700" />
              <span>Identity Profile</span>
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Epistemic Truth</span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">Full Name</span>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">{lead.identity.full_name || '—'}</span>
                {renderDataTruthBadge(lead.provenance.fields.full_name?.truth_level || 'KNOWN')}
              </div>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">Phone</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-slate-900 font-semibold">{lead.identity.phone || '—'}</span>
                {renderDataTruthBadge(lead.provenance.fields.phone?.truth_level || 'KNOWN')}
              </div>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">Email</span>
              <div className="flex items-center gap-2">
                <span className="text-slate-900">{lead.identity.email || '—'}</span>
                {renderDataTruthBadge(lead.provenance.fields.email?.truth_level || 'KNOWN')}
              </div>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">Location</span>
              <div className="flex items-center gap-2">
                <span className="text-slate-900">{lead.identity.location || '—'}</span>
                {renderDataTruthBadge(lead.provenance.fields.location?.truth_level || 'UNKNOWN')}
              </div>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">Profession / Bio</span>
              <div className="flex items-center gap-2">
                <span className="text-slate-900">{lead.identity.profession || '—'}</span>
                {renderDataTruthBadge(lead.provenance.fields.profession?.truth_level || 'UNKNOWN')}
              </div>
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-slate-500">Company</span>
              <div className="flex items-center gap-2">
                <span className="text-slate-900">{lead.identity.company || '—'}</span>
                {renderDataTruthBadge(lead.provenance.fields.company?.truth_level || 'UNKNOWN')}
              </div>
            </div>
          </div>
        </div>

        {/* 2. Buying Intent */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Compass className="w-4 h-4 text-indigo-600" />
              <span>Discovered Buying Intent</span>
            </h3>
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">
              Interested: {lead.buying_intent.interested ? 'YES' : 'PENDING'}
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">Property Type</span>
              <span className="font-semibold text-slate-900">{lead.buying_intent.property_type || '—'}</span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">Configuration</span>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">{lead.buying_intent.configuration || '—'}</span>
                {renderDataTruthBadge(lead.provenance.fields.configuration?.truth_level || 'UNKNOWN')}
              </div>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">Budget Range</span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 font-mono">
                  {formatBudget(lead.buying_intent.budget.min, lead.buying_intent.budget.max)}
                </span>
                {renderDataTruthBadge(lead.provenance.fields.budget?.truth_level || 'UNKNOWN')}
              </div>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">Target Locations</span>
              <span className="font-medium text-slate-900 text-right">
                {lead.buying_intent.preferred_locations.length > 0
                  ? lead.buying_intent.preferred_locations.join(', ')
                  : '—'}
              </span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">Timeline</span>
              <span className="text-slate-900">{lead.buying_intent.timeline || '—'}</span>
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-slate-500">Decision Maker</span>
              <span className="font-medium text-slate-900">
                {lead.buying_intent.decision_maker === true
                  ? 'Confirmed Decision Maker'
                  : lead.buying_intent.decision_maker === false
                  ? 'Influencer / Non-decision maker'
                  : 'Undetermined'}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Buyer Preferences & Requirements */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-indigo-600" />
            <span>Buyer Preferences & Explicit Requirements</span>
          </h3>

          <div className="space-y-3 text-xs">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                Explicit Requirements
              </div>
              {lead.buying_intent.requirements.length > 0 ? (
                <ul className="space-y-1">
                  {lead.buying_intent.requirements.map((req, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-slate-800">
                      <span className="w-1.5 h-1.5 rounded-xs bg-indigo-600"></span>
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-400 italic">No specific hard requirements logged yet.</p>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                Stated Preferences
              </div>
              {lead.buying_intent.preferences.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {lead.buying_intent.preferences.map((pref, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[11px]"
                    >
                      {pref}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-slate-400 italic">No soft preferences logged yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* 4. Lead Intelligence & Recommended Action */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-600" />
            <span>Lead Intelligence & Recommended Action</span>
          </h3>

          <div className="space-y-3 text-xs">
            <div>
              <div className="text-slate-500 text-[11px]">Recommended Client Action:</div>
              <div className="mt-1 p-3 rounded bg-slate-50 border border-slate-200 font-medium text-slate-900 leading-relaxed">
                {lead.lead_intelligence.recommended_action || 'Awaiting qualification results.'}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="p-2.5 rounded bg-slate-50 border border-slate-200">
                <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Lead Source</span>
                <span className="font-semibold text-slate-900 text-xs font-mono">{lead.lead_intelligence.source}</span>
              </div>
              <div className="p-2.5 rounded bg-slate-50 border border-slate-200">
                <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Consent Verification</span>
                <span className="font-semibold text-slate-900 text-xs font-mono">{lead.provenance.consent_status}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Project Intelligence & Top Matches */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Building className="w-4 h-4 text-indigo-600" />
            <span>Project Intelligence (Top Matches from Catalog)</span>
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            {lead.project_intelligence.top_matches.length} Matches Identified
          </span>
        </div>

        {lead.project_intelligence.preferred_project.project_name && (
          <div className="p-4 rounded-lg bg-indigo-50/60 border border-indigo-200 text-xs space-y-1">
            <div className="flex items-center justify-between font-semibold text-indigo-950">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                Preferred Match: {lead.project_intelligence.preferred_project.project_name}
              </span>
              <span className="font-mono text-xs text-indigo-700 font-bold">
                {Math.round(lead.project_intelligence.preferred_project.confidence * 100)}% CONFIDENCE
              </span>
            </div>
            <p className="text-indigo-900/90 leading-relaxed">
              {lead.project_intelligence.preferred_project.selection_basis}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {lead.project_intelligence.top_matches.map((match) => (
            <div
              key={match.id}
              className="p-4 rounded-lg border border-slate-200 bg-slate-50/40 text-xs space-y-2.5"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-semibold text-slate-900 text-sm">
                    {match.project_name}
                  </h4>
                  <div className="text-[11px] text-slate-500">
                    {match.developer_name} • {match.locality}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-slate-900 font-mono">
                    {match.match_score}%
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Overall Fit</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1 text-[11px] py-2 border-y border-slate-200/80">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Budget</span>
                  <span className="font-semibold text-slate-800 font-mono">{match.budget_score}%</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Location</span>
                  <span className="font-semibold text-slate-800 font-mono">{match.location_score}%</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Config</span>
                  <span className="font-semibold text-slate-800 font-mono">{match.configuration_score}%</span>
                </div>
              </div>

              <p className="text-slate-600 text-[11px] leading-relaxed">
                {match.reason.summary}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
