import React, { useState, useRef } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowRight,
  Database,
  RefreshCw,
  Copy,
  AlertTriangle,
} from 'lucide-react';
import { ingestCSVLeads, ImportSummary } from '../../app/services/leads/csvIngestion';
import { supabaseDataService } from '../../app/services/supabase/repositories';
import { GFBuyerLead } from '../../app/schemas/buyerLead';

interface LeadImportViewProps {
  onImportSuccess: (importedLeads: GFBuyerLead[]) => void;
  onProceedToProcessing: () => void;
  onSelectLead?: (lead: GFBuyerLead) => void;
}

const SAMPLE_CSV = `name,phone,email,source,source_reference
Manish Malhotra,+91 98200 12345,manish.m@couture.in,Instagram Ad,IG_LUXURY_MUM_01
Siddharth Singhania,+91 98101 99881,siddharth.s@singhania.org,Direct Web Inquiry,WEB_INQ_DLF_63
Dr. Rashmi Kulkarni,+91 94220 56789,dr.rashmi@medicare.com,Referral Partner,PARTNER_MED_PUN
Harshvardhan Goenka,+91 98310 44552,hgoenka@enterprises.com,Ad Landing Page,CAMP_GOLF_EST_09
Kavita Narang,+91 98188 77665,kavita.narang@designhub.co,Facebook Lead Form,FB_LEAD_SOUTH_DELHI`;

export const LeadImportView: React.FC<LeadImportViewProps> = ({
  onImportSuccess,
  onProceedToProcessing,
  onSelectLead,
}) => {
  const [csvContent, setCsvContent] = useState<string>('');
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importedGFLeads, setImportedGFLeads] = useState<GFBuyerLead[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState<'leads' | 'errors'>('leads');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const processCSVText = async (text: string) => {
    setIsProcessing(true);
    try {
      setCsvContent(text);
      const summary = await ingestCSVLeads(text);
      setImportSummary(summary);

      // Fetch canonical GF Buyer Lead dossiers for each created lead
      const canonicalLeads: GFBuyerLead[] = [];
      for (const lead of summary.createdLeads) {
        const gf = await supabaseDataService.mapToGFBuyerLead(lead.id);
        if (gf) canonicalLeads.push(gf);
      }

      setImportedGFLeads(canonicalLeads);
      onImportSuccess(canonicalLeads);
    } catch (err) {
      console.error('CSV Ingestion failed:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      processCSVText(text);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      processCSVText(text);
    };
    reader.readAsText(file);
  };

  const loadSampleCSV = () => {
    processCSVText(SAMPLE_CSV);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header & Architecture Context */}
      <div className="space-y-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
          <Database className="w-3.5 h-3.5 text-indigo-600" />
          <span className="text-[10px] font-bold uppercase tracking-widest">
            Phase 1: Supabase Foundation & Lead Ingestion
          </span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Lead Intake & Resolver
        </h2>
        <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
          Ingests raw CSV records directly into the Supabase database. The deterministic
          <span className="font-semibold text-slate-800"> Lead Resolver</span> trims inputs, validates
          email/phone formats, detects duplicates on phone/email priorities, generates canonical
          <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono text-xs ml-1">
            GF-YYYY-NNNNNN
          </code>{' '}
          IDs, and writes an immutable audit trail to <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono text-xs">lead_events</code>.
        </p>
      </div>

      {/* Upload Zone */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-xs space-y-6">
        <div
          id="csv-dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragOver
              ? 'border-indigo-500 bg-indigo-50/50'
              : 'border-slate-300 hover:border-indigo-400 bg-slate-50/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center mx-auto mb-3 text-indigo-600 shadow-xs">
            {isProcessing ? (
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
            ) : (
              <Upload className="w-6 h-6" />
            )}
          </div>
          <div className="text-sm font-semibold text-slate-900 mb-1">
            {isProcessing ? 'Persisting Leads to Supabase...' : 'Choose CSV file or drag and drop here'}
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Minimum required columns: <code className="font-mono text-slate-700 font-semibold">name</code>,{' '}
            <code className="font-mono text-slate-700 font-semibold">phone</code>,{' '}
            <code className="font-mono text-slate-700 font-semibold">email</code>,{' '}
            <code className="font-mono text-slate-700 font-semibold">source</code> (optional:{' '}
            <code className="font-mono text-slate-700">source_reference</code>)
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 shadow-xs">
            <FileText className="w-3.5 h-3.5 text-slate-500" />
            <span>Browse CSV File</span>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={loadSampleCSV}
            disabled={isProcessing}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline underline-offset-4 flex items-center gap-1 cursor-pointer"
          >
            <span>Load Sample Raw Leads (5 Records)</span>
          </button>

          {importedGFLeads.length > 0 && (
            <button
              id="start-qualification-button"
              type="button"
              disabled={isProcessing}
              onClick={onProceedToProcessing}
              className="px-5 py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-semibold tracking-wide transition-all shadow-xs flex items-center gap-2 cursor-pointer"
            >
              <span>VIEW PIPELINE STATUS</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Section 14: Import Summary Metrics Grid */}
      {importSummary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="bg-white border border-slate-200 rounded-lg p-3 text-center shadow-xs">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Rows</div>
              <div className="text-xl font-bold text-slate-900 mt-1 font-mono">{importSummary.total_rows}</div>
            </div>

            <div className="bg-white border border-emerald-200 rounded-lg p-3 text-center shadow-xs bg-emerald-50/20">
              <div className="text-xs font-medium text-emerald-700 uppercase tracking-wider">Accepted</div>
              <div className="text-xl font-bold text-emerald-700 mt-1 font-mono">{importSummary.accepted}</div>
            </div>

            <div className="bg-white border border-indigo-200 rounded-lg p-3 text-center shadow-xs bg-indigo-50/20">
              <div className="text-xs font-medium text-indigo-700 uppercase tracking-wider">Created</div>
              <div className="text-xl font-bold text-indigo-700 mt-1 font-mono">{importSummary.created}</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-3 text-center shadow-xs">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Updated</div>
              <div className="text-xl font-bold text-slate-700 mt-1 font-mono">{importSummary.updated}</div>
            </div>

            <div className="bg-white border border-amber-200 rounded-lg p-3 text-center shadow-xs bg-amber-50/20">
              <div className="text-xs font-medium text-amber-700 uppercase tracking-wider">Duplicates</div>
              <div className="text-xl font-bold text-amber-700 mt-1 font-mono">{importSummary.duplicates}</div>
            </div>

            <div className="bg-white border border-rose-200 rounded-lg p-3 text-center shadow-xs bg-rose-50/20">
              <div className="text-xs font-medium text-rose-700 uppercase tracking-wider">Invalid</div>
              <div className="text-xl font-bold text-rose-700 mt-1 font-mono">{importSummary.invalid}</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-3 text-center shadow-xs">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Errors</div>
              <div className="text-xl font-bold text-slate-900 mt-1 font-mono">{importSummary.errors.length}</div>
            </div>
          </div>

          {/* Results Table & Error Log */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
            <div className="p-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('leads')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                    activeTab === 'leads'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  Persisted Leads ({importSummary.createdLeads.length})
                </button>
                {importSummary.errors.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('errors')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                      activeTab === 'errors'
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'text-rose-700 hover:text-rose-900 hover:bg-rose-50'
                    }`}
                  >
                    Errors & Conflicts ({importSummary.errors.length})
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-600 font-mono">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Supabase PostgreSQL Synced</span>
              </div>
            </div>

            {activeTab === 'leads' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-semibold text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-4">Canonical Lead ID</th>
                      <th className="py-2.5 px-4">Buyer Name</th>
                      <th className="py-2.5 px-4">Normalized Phone</th>
                      <th className="py-2.5 px-4">Email</th>
                      <th className="py-2.5 px-4">Source Channel</th>
                      <th className="py-2.5 px-4">Workflow Status</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importedGFLeads.map((lead) => (
                      <tr key={lead.lead_id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-4 font-mono font-semibold text-indigo-700">
                          {lead.lead_id}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-slate-900">
                          {lead.identity.full_name || '—'}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">
                          {lead.identity.phone || '—'}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {lead.identity.email || '—'}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px]">
                            {lead.lead_intelligence.source}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded font-mono font-semibold text-[10px] border ${
                              lead.workflow.status === 'REQUIRES_REVIEW'
                                ? 'bg-amber-50 text-amber-800 border-amber-300'
                                : 'bg-slate-100 text-slate-800 border-slate-200'
                            }`}
                          >
                            {lead.workflow.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {onSelectLead && (
                            <button
                              type="button"
                              onClick={() => onSelectLead(lead)}
                              className="text-xs text-indigo-600 hover:text-indigo-900 font-semibold cursor-pointer underline"
                            >
                              Inspect Dossier
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 space-y-2">
                {importSummary.errors.map((err, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs"
                  >
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold font-mono">Row {err.row}:</span> {err.message}
                      {err.data && (
                        <div className="mt-1 font-mono text-[10px] text-slate-600 bg-white/70 p-1.5 rounded border border-rose-100">
                          {JSON.stringify(err.data)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
