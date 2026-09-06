import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Sparkles, ArrowRight, Table } from 'lucide-react';
import { parseCSVLeads, IngestionBatchResult } from '../services/leads/leadIngestion';
import { GFBuyerLead } from '../types/buyerLead';

interface LeadImportViewProps {
  onImportSuccess: (importedLeads: GFBuyerLead[]) => void;
  onProceedToProcessing: () => void;
}

const SAMPLE_CSV = `name,phone,email,source,location
Manish Malhotra,+91 98200 12345,manish.m@couture.in,Instagram Ad,Mumbai / Delhi
Siddharth Singhania,+91 98101 99881,siddharth.s@singhania.org,Direct Web Inquiry,Gurgaon
Dr. Rashmi Kulkarni,+91 94220 56789,dr.rashmi@medicare.com,Referral Partner,Pune / NCR Relocation
Harshvardhan Goenka,+91 98310 44552,hgoenka@enterprises.com,Ad Landing Page,Kolkata / Gurgaon
Kavita Narang,+91 98188 77665,kavita.narang@designhub.co,Facebook Lead Form,South Delhi`;

export const LeadImportView: React.FC<LeadImportViewProps> = ({
  onImportSuccess,
  onProceedToProcessing,
}) => {
  const [csvContent, setCsvContent] = useState<string>('');
  const [parseResult, setParseResult] = useState<IngestionBatchResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvContent(text);
      const parsed = parseCSVLeads(text);
      setParseResult(parsed);
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
      setCsvContent(text);
      const parsed = parseCSVLeads(text);
      setParseResult(parsed);
    };
    reader.readAsText(file);
  };

  const loadSampleCSV = () => {
    setCsvContent(SAMPLE_CSV);
    const parsed = parseCSVLeads(SAMPLE_CSV);
    setParseResult(parsed);
  };

  const handleStartQualification = () => {
    if (!parseResult || parseResult.validLeads.length === 0) return;
    setIsProcessing(true);
    onImportSuccess(parseResult.validLeads);
    setTimeout(() => {
      setIsProcessing(false);
      onProceedToProcessing();
    }, 400);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Title & Architecture Rules */}
      <div className="space-y-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Campaign-Agnostic Lead Intake</span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Upload Raw Leads
        </h2>
        <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
          The intake layer strictly requires contact identifiers (<code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono text-xs">name</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono text-xs">phone</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono text-xs">email</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono text-xs">source</code>). Budget, configuration, property type, and target project are discovered autonomously through public enrichment and voice qualification.
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
            <Upload className="w-6 h-6" />
          </div>
          <div className="text-sm font-semibold text-slate-900 mb-1">
            Choose CSV file or drag and drop here
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Standard CSV format: name, phone, email, source, location (optional)
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
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline underline-offset-4 flex items-center gap-1 cursor-pointer"
          >
            <span>Load Sample Raw Leads (5 Records)</span>
          </button>

          {parseResult && parseResult.validLeads.length > 0 && (
            <button
              id="start-qualification-button"
              type="button"
              disabled={isProcessing}
              onClick={handleStartQualification}
              className="px-5 py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-semibold tracking-wide transition-all shadow-xs flex items-center gap-2 cursor-pointer"
            >
              <span>{isProcessing ? 'INITIALIZING PIPELINE...' : 'START QUALIFICATION'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Parse Preview */}
      {parseResult && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Table className="w-4 h-4 text-slate-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                Parsed Intake Leads ({parseResult.validLeads.length} valid, {parseResult.errors.length} rejected)
              </h3>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-emerald-700 font-medium font-mono text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5" /> READY FOR PIPELINE
              </span>
              {parseResult.errors.length > 0 && (
                <span className="flex items-center gap-1 text-rose-700 font-medium font-mono text-[11px]">
                  <AlertCircle className="w-3.5 h-3.5" /> {parseResult.errors.length} FORMAT ERRORS
                </span>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-semibold text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-4">Assigned Lead ID</th>
                  <th className="py-2.5 px-4">Full Name</th>
                  <th className="py-2.5 px-4">Phone</th>
                  <th className="py-2.5 px-4">Email</th>
                  <th className="py-2.5 px-4">Source</th>
                  <th className="py-2.5 px-4">Initial State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parseResult.validLeads.map((lead) => (
                  <tr key={lead.lead_id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-medium text-slate-900">
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
                      <span className="px-2 py-0.5 rounded font-mono font-semibold text-[10px] bg-slate-100 text-slate-800 border border-slate-200">
                        {lead.workflow.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
