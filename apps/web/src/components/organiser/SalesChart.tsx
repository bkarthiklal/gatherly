import type { EventAnalytics } from '@gatherly/types';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatAmount } from '../../lib/format';

/** Daily ticket sales. Loaded as its own chunk so charting code never slows the public pages. */
export default function SalesChart({ data }: { data: EventAnalytics['salesByDay'] }) {
  const rows = data.map((d) => ({
    ...d,
    label: new Date(`${d.date}T00:00:00+05:30`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    }),
  }));
  return (
    <div className="h-64" role="img" aria-label={`Tickets sold per day across ${rows.length} days`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: '#eef2ff' }}
            formatter={(value, name) =>
              name === 'tickets' ? [value, 'Tickets'] : [formatAmount(Number(value)), 'Revenue']
            }
          />
          <Bar
            dataKey="tickets"
            fill="#4f46e5"
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
