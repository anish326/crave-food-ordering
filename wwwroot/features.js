const featureRatings = new Map();
const featurePicks = new Map();
const featurePending = new Set();
let featureNotices = readSaved('crave-notifications', []);
if (!Array.isArray(featureNotices)) featureNotices = [];
let featurePolling = false;
const featureStatus = new Map(experience.history.map(o => [o.id, o.status]));

function ratingMarkup(id) {
  const rating = featureRatings.get(id);
  return `<span class="rating-chip">★ ${rating?.count ? `${rating.average.toFixed(1)} <small>(${rating.count} verified ${rating.count === 1 ? 'review' : 'reviews'})</small>` : '<small>New · no reviews yet</small>'}</span>`;
}
function progressMarkup(order) {
  if (order.status === 'Cancelled') return '<div class="progress-cancelled"><strong>Order cancelled</strong><p>Your kitchen has stopped this order. No payment is due.</p></div>';
  const steps = [['Placed','Order received'],['Preparing','Freshly made for you'],['Ready','Packed and ready'],['Out for delivery','On the way to your door'],['Completed','Enjoy every bite']];
  const current = steps.findIndex(s => s[0] === order.status);
  return `<ol class="progress-steps" aria-label="Order progress">${steps.map(([label,detail],i) => {
    const stamp = order.statusHistory?.find(e => e.status === label)?.at || (i === 0 ? order.placedAt : null);
    return `<li class="${i < current ? 'finished' : i === current ? 'current' : 'upcoming'}" ${i === current ? 'aria-current="step"' : ''}><span class="progress-dot">${i < current ? '✓' : i+1}</span><div><strong>${label}</strong><small>${detail}</small>${stamp ? `<time datetime="${escapeHtml(stamp)}">${escapeHtml(new Date(stamp).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}</time>` : ''}</div></li>`;
  }).join('')}</ol>`;
}
function preparationMarkup(order) {
  if (['Completed','Cancelled'].includes(order.status)) return '';
  if (order.status === 'Out for delivery') return '<div class="prep-estimate"><span>↗</span><div><strong>Your meal is on its way</strong><small>Check the courier map for the latest shared location.</small></div></div>';
  if (order.status === 'Ready') return '<div class="prep-estimate"><span>✓</span><div><strong>Ready for your courier</strong><small>Your food is packed. Waiting for dispatch.</small></div></div>';
  if (!order.estimatedReadyAt) return '';
  const ready = new Date(order.estimatedReadyAt), minutes = Math.ceil((ready-Date.now())/60000);
  return `<div class="prep-estimate"><span>◷</span><div><strong>${minutes > 0 ? `About ${minutes} min until food is ready` : 'The kitchen is taking a little longer'}</strong><small>Estimated preparation by ${escapeHtml(ready.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))} · delivery time is additional.</small></div></div>`;
}
async function loadRestaurantFeatures(id) {
  if (!id || featurePending.has(id)) return;
  featurePending.add(id);
  try {
    const response = await fetch(`/api/restaurants/${encodeURIComponent(id)}/reviews`);
    if (!response.ok) throw new Error('Reviews are temporarily unavailable.');
    const data = await response.json(); featureRatings.set(id,data.rating);
    if (isRestaurantPage && pageRestaurantId === id) {
      const target = $('#restaurant-reviews');
      if (target) target.innerHTML = `<div class="section-kicker">FROM THE TABLE</div><div class="reviews-heading"><h2>Real orders.<br><em>Honest reviews.</em></h2><div>${ratingMarkup(id)}<p>Only customers with completed orders can review.</p></div></div><div class="review-list">${data.reviews.length ? data.reviews.map(r => `<article class="review-card"><header><span class="review-avatar">${escapeHtml(r.displayName.slice(0,1))}</span><div><strong>${escapeHtml(r.displayName)}</strong><small>Verified order · ${escapeHtml(new Date(r.createdAt).toLocaleDateString())}</small></div><span class="review-stars" aria-label="${r.stars} out of 5 stars">${'★'.repeat(r.stars)}${'☆'.repeat(5-r.stars)}</span></header><p>${escapeHtml(r.comment)}</p></article>`).join('') : '<div class="review-empty">Be the first to share a bite.<p>After your delivery is completed, open My orders → Track order to leave a review.</p></div>'}</div>`;
      renderRestaurantHeader();
    }
  } catch(error) { if ($('#restaurant-reviews')) $('#restaurant-reviews').innerHTML = `<h2>Customer reviews</h2><p>${escapeHtml(error.message)}</p><button type="button" data-retry-reviews>Try again</button>`; }
  finally { featurePending.delete(id); }
}
async function loadPicks(id) {
  if (!id || featurePicks.has(id) || featurePending.has('picks:'+id)) return;
  featurePending.add('picks:'+id);
  try {
    const response = await fetch(`/api/restaurants/${encodeURIComponent(id)}/recommendations`);
    if (!response.ok) return;
    featurePicks.set(id,await response.json()); renderRecommendations();
  } catch {} finally { featurePending.delete('picks:'+id); }
}
function renderRecommendations() {
  let box = $('#bag-recommendations');
  if (!box) { box=document.createElement('section'); box.id='bag-recommendations'; $('#cart-items').after(box); }
  const id=cartRestaurantId();
  if (!id) { box.innerHTML=''; return; }
  if (!featurePicks.has(id)) { box.innerHTML=''; loadPicks(id); return; }
  const categories=new Set(cartLines().map(l=>l.item.category));
  const pairScore = p => (categories.has(p.item.category) ? 0 : ({Sides:100,Drinks:90,Desserts:80}[p.item.category] || 10)) + (p.item.popular ? 1 : 0);
  const choices=featurePicks.get(id).filter(p=>!state.cart[p.item.id] && state.menu.some(m=>m.id===p.item.id && m.available !== false))
    .sort((a,b)=>pairScore(b)-pairScore(a)).slice(0,3);
  box.innerHTML=choices.length ? `<div class="section-kicker">MAKE IT A MEAL</div><h3>A little something extra?</h3><p>Pairs from ${escapeHtml(restaurantName(id))}</p>${choices.map(({item,completedOrdersQuantity})=>`<article class="pairing"><span class="pairing-icon">${escapeHtml(item.emoji)}</span><div><strong>${escapeHtml(item.name)}</strong><small>${completedOrdersQuantity > 0 ? `${completedOrdersQuantity} ordered in completed orders` : item.popular ? 'Kitchen favorite' : item.category} · ${money(item.price)}</small></div><button type="button" data-add="${escapeHtml(item.id)}" aria-label="Add ${escapeHtml(item.name)} to cart">+</button></article>`).join('')}` : '';
}
async function renderReviewForm(order) {
  if(order.status!=='Completed') return;
  const host=document.createElement('section');host.id='order-review';host.className='order-review';$('#track-result .tracked-order')?.append(host);
  const email=$('#track-email').value.trim();
  try {
    const response=await fetch(`/api/orders/${encodeURIComponent(order.id)}/review?email=${encodeURIComponent(email)}`);
    if(!response.ok) throw new Error('Unable to check review eligibility.');
    const data=await response.json();
    if(trackedOrder?.id!==order.id || !host.isConnected) return;
    if(!data.eligible) {host.innerHTML=`<h3>Thanks for sharing your experience</h3><p>${escapeHtml(data.reason)}</p>${data.review ? `<span class="review-stars">${'★'.repeat(data.review.stars)}</span><p>${escapeHtml(data.review.comment)}</p>`:''}`;return;}
    host.innerHTML=`<span class="section-kicker">HOW WAS YOUR MEAL?</span><h3>Rate your kitchen</h3><p>Your review will appear publicly with your first name. Please leave out personal details.</p><form id="review-form" data-order="${escapeHtml(order.id)}"><fieldset class="star-picker"><legend>Restaurant rating</legend>${[1,2,3,4,5].map(n=>`<label><input type="radio" name="stars" value="${n}" required><span>${n} ★</span></label>`).join('')}</fieldset><label>Your review<textarea name="comment" required minlength="3" maxlength="1000" rows="3" placeholder="What did you love? What could be better?"></textarea></label><p class="form-message" role="status"></p><button class="button button-dark" type="submit">PUBLISH REVIEW ↗</button></form>`;
  } catch(error) {host.innerHTML=`<p>${escapeHtml(error.message)} Reopen tracking to try again.</p>`;}
}
document.addEventListener('submit',async event=>{
  if(event.target.id!=='review-form')return;event.preventDefault();const form=event.target,button=form.querySelector('button'),message=form.querySelector('[role="status"]');button.disabled=true;
  try {
    const response=await fetch(`/api/orders/${encodeURIComponent(form.dataset.order)}/review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('#track-email').value.trim(),stars:Number(new FormData(form).get('stars')),comment:form.elements.comment.value})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not publish review.');
    form.innerHTML='<p class="review-thanks">✓ Thank you! Your verified review is now published.</p>';
    if(isRestaurantPage)loadRestaurantFeatures(pageRestaurantId);
    const ratings=await fetch('/api/ratings');if(ratings.ok){(await ratings.json()).forEach(r=>featureRatings.set(r.restaurantId,r));renderRestaurants();}
  }catch(error){message.textContent=error.message;button.disabled=false;}
});
function notifyOrderChange(order) {
  const previous=featureStatus.get(order.id);featureStatus.set(order.id,order.status);
  if(!previous || previous===order.status)return;
  const history=order.statusHistory || [];
  const previousIndex=history.map(e=>e.status).lastIndexOf(previous);
  const changes=previousIndex >= 0 ? history.slice(previousIndex+1) : [{status:order.status,at:new Date().toISOString()}];
  for(const change of changes){featureNotices.unshift({id:order.id,status:change.status,restaurant:order.restaurantName||restaurantName(order.restaurantId),at:change.at,read:false});}
  featureNotices=featureNotices.slice(0,30);persist('crave-notifications',featureNotices);renderNotifications();
  toast(`${order.restaurantName||restaurantName(order.restaurantId)}: your order is ${order.status.toLowerCase()}.`);
}
function renderNotifications() {
  const unread=featureNotices.filter(n=>!n.read).length;
  document.querySelectorAll('[data-notice-toggle]').forEach(b=>{b.textContent=`Updates${unread?' ('+unread+')':''}`;b.setAttribute('aria-label',`Order updates, ${unread} unread`);});
  $('#notification-list').innerHTML=featureNotices.length?featureNotices.map(n=>`<article class="notice ${n.read?'':'unread'}"><span class="notice-dot"></span><div><strong>${escapeHtml(n.restaurant)}</strong><p>Order #${escapeHtml(n.id)} · ${escapeHtml(n.status)}</p><small>${escapeHtml(new Date(n.at).toLocaleString())}</small><button type="button" data-notice-order="${escapeHtml(n.id)}">VIEW ORDER ↗</button></div></article>`).join(''):'<p class="notice-empty">Your order updates will appear here as the kitchen prepares your meal.</p>';
}
async function pollOrderNotifications() {
  if(featurePolling || document.hidden || previewMode)return;featurePolling=true;
  try {
    for(const entry of experience.history.filter(o=>!['Completed','Cancelled'].includes(o.status)).slice(0,5)) {
      try {const response=await fetch(`/api/orders/${encodeURIComponent(entry.id)}?email=${encodeURIComponent(entry.email)}`);if(!response.ok)continue;const order=await response.json();notifyOrderChange(order);rememberOrder(order,entry.email);}catch{}
    }
  }finally{featurePolling=false;}
}
function initializeFeatures(){
  const bagScroll=document.createElement("div");bagScroll.className="bag-scroll";const bagItems=$("#cart-items");bagItems.before(bagScroll);bagScroll.append(bagItems);if($("#bag-recommendations"))bagScroll.append($("#bag-recommendations"));
  const button=document.createElement('button');button.type='button';button.dataset.noticeToggle='';button.setAttribute('aria-expanded','false');$('.service-actions')?.prepend(button);
  const panel=document.createElement('section');panel.id='notification-panel';panel.className='notification-panel';panel.hidden=true;panel.setAttribute('aria-label','Order updates');panel.innerHTML='<header><h3>Order updates</h3><button type="button" data-notice-close aria-label="Close order updates">×</button></header><p>Updates refresh while this page is open.</p><div id="notification-list" aria-live="polite"></div>';document.body.append(panel);
  renderNotifications();
  fetch('/api/ratings').then(r=>r.ok?r.json():[]).then(ratings=>{ratings.forEach(r=>featureRatings.set(r.restaurantId,r));renderRestaurants();if(isRestaurantPage)renderRestaurantHeader();}).catch(()=>{});
  if(isRestaurantPage)loadRestaurantFeatures(pageRestaurantId);
  setInterval(pollOrderNotifications,30000);
  setInterval(()=>{if(trackedOrder && activeDialog===$('#track-modal')){const target=$('#track-preparation');if(target)target.innerHTML=preparationMarkup(trackedOrder);}},30000);
}
document.addEventListener('click',event=>{
  if(event.target.closest('[data-retry-reviews]'))loadRestaurantFeatures(pageRestaurantId);
  if(event.target.closest('[data-notice-toggle]')){
    const panel=$('#notification-panel');panel.hidden=!panel.hidden;
    event.target.closest('button').setAttribute('aria-expanded',String(!panel.hidden));
    if(!panel.hidden){featureNotices.forEach(n=>n.read=true);persist('crave-notifications',featureNotices);renderNotifications();}
  }
  if(event.target.closest('[data-notice-close]')){$('#notification-panel').hidden=true;$('[data-notice-toggle]')?.setAttribute('aria-expanded','false');}
  const orderLink=event.target.closest('[data-notice-order]');
  if(orderLink){const entry=experience.history.find(o=>o.id===orderLink.dataset.noticeOrder);if(!entry)return;$('#notification-panel').hidden=true;openDialog('#track-modal');trackedOrder=null;$('#track-code').value=entry.id;$('#track-email').value=entry.email;loadTrackedOrder();}
});
initializeFeatures();
