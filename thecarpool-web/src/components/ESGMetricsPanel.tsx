"use client";

import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Leaf, Zap, Users } from "lucide-react";

const mockCarbonData = [
  { month: "Jan", offset: 120 },
  { month: "Feb", offset: 210 },
  { month: "Mar", offset: 350 },
  { month: "Apr", offset: 480 },
  { month: "May", offset: 640 },
  { month: "Jun", offset: 890 },
];

export default function ESGMetricsPanel() {
  return (
    <div className="space-y-6">
      {/* Top Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-6 rounded-2xl flex items-center space-x-4">
          <div className="p-4 bg-emerald-100 dark:bg-emerald-900 rounded-full text-emerald-600 dark:text-emerald-400">
            <Leaf size={28} />
          </div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Total Carbon Offset</p>
            <h3 className="text-3xl font-bold text-slate-800 dark:text-white">8,450 kg</h3>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl flex items-center space-x-4">
          <div className="p-4 bg-blue-100 dark:bg-blue-900 rounded-full text-blue-600 dark:text-blue-400">
            <Zap size={28} />
          </div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">EV Adoption Rate</p>
            <h3 className="text-3xl font-bold text-slate-800 dark:text-white">42.5%</h3>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl flex items-center space-x-4">
          <div className="p-4 bg-purple-100 dark:bg-purple-900 rounded-full text-purple-600 dark:text-purple-400">
            <Users size={28} />
          </div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Active Carpools</p>
            <h3 className="text-3xl font-bold text-slate-800 dark:text-white">1,240</h3>
          </div>
        </div>
      </div>

      {/* Main Chart Row */}
      <div className="glass-panel p-6 rounded-2xl">
        <h3 className="text-xl font-semibold mb-6 text-slate-800 dark:text-white">CO2 Offset Growth (YTD)</h3>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mockCarbonData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="month" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
              />
              <Line 
                type="monotone" 
                dataKey="offset" 
                stroke="#10b981" 
                strokeWidth={4}
                dot={{ r: 6, strokeWidth: 2, fill: "#fff" }}
                activeDot={{ r: 8, stroke: '#10b981', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
