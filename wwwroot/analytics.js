let analyticsRequest = 0;
async function loadAnalytics(){
  const requestId=++analyticsRequest;
  const error=$('#analytics-error');error.textContent='';
  const period=$('#analytics-period').value,restaurantId=$('#analytics-restaurant').value;
  try{
    const data=await api(`/api/admin/analytics?period=${encodeURIComponent(period)}&restaurantId=${encodeURIComponent(restaurantId)}`);
    if(requestId!==analyticsRequest)return;
    $('#analytics-range').textContent=`${data.from} — ${data.to} · Asia/Kolkata · grouped by order date`;
    $('#analytics-stats').innerHTML=[['ORDERS',data.totalOrders,'All statuses'],['FOOD SALES',money(data.sales),'Completed orders, after discounts'],['AVERAGE ORDER',money(data.averageOrder),'Completed food sales ÷ completed orders'],['COMPLETION RATE',data.totalOrders?Math.round(data.completed/data.totalOrders*100)+'%':'—','Of orders placed in this period']].map(([label,value,note])=>`<article><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
    const max=Math.max(1,...data.series.map(d=>d.orders));
    $('#analytics-chart').innerHTML=`<div class="chart-bars" role="img" aria-label="${period==='weekly'?'Weekly':'Daily'} order counts. ${safe(data.series.map(d=>d.date+': '+d.orders+' orders').join('; '))}">${data.series.map(d=>`<div class="chart-column"><strong>${d.orders}</strong><div class="chart-track"><span style="height:${d.orders/max*100}%"></span></div><small>${safe(new Date(d.date+'T12:00:00').toLocaleDateString([],{month:'short',day:'numeric'}))}</small></div>`).join('')}</div><details class="analytics-data"><summary>View chart data</summary><table><thead><tr><th>Date</th><th>Orders</th><th>Completed</th><th>Cancelled</th><th>Food sales</th></tr></thead><tbody>${data.series.map(d=>`<tr><td>${safe(d.date)}</td><td>${d.orders}</td><td>${d.completed}</td><td>${d.cancelled}</td><td>${money(d.sales)}</td></tr>`).join('')}</tbody></table></details>`;
    $('#analytics-outcomes').innerHTML=[['Completed',data.completed,'complete'],['Cancelled',data.cancelled,'cancelled'],['In progress',data.active,'active']].map(([label,value,cl])=>`<div class="outcome-row"><span>${label}</span><strong>${value}</strong><div><i class="${cl}" style="width:${data.totalOrders?value/data.totalOrders*100:0}%"></i></div></div>`).join('');
    $('#analytics-popular').innerHTML=data.popularDishes.length?data.popularDishes.map((d,i)=>`<div class="popular-dish"><b>0${i+1}</b><span>${safe(d.name)}</span><strong>${d.quantity}<small> sold</small></strong></div>`).join(''):'<p class="analytics-empty">Popular dishes appear after the first completed order.</p>';
    $('#analytics-sales').innerHTML=`<table><thead><tr><th>Restaurant</th><th>Orders</th><th>Completed</th><th>Food sales</th></tr></thead><tbody>${data.restaurants.map(r=>`<tr><td>${safe(r.name)}</td><td>${r.orders}</td><td>${r.completed}</td><td>${money(r.sales)}</td></tr>`).join('')}</tbody></table>`;
  }catch(err){if(requestId===analyticsRequest)error.textContent=err.message;}
}
function setupAnalyticsFilters(){const select=$('#analytics-restaurant');const value=select.value;select.innerHTML='<option value="">All restaurants</option>'+state.restaurants.map(r=>`<option value="${safe(r.id)}">${safe(r.name)}</option>`).join('');select.value=value;}
$('#analytics-period').addEventListener('change',loadAnalytics);
$('#analytics-restaurant').addEventListener('change',loadAnalytics);
$('#refresh-analytics').addEventListener('click',loadAnalytics);
