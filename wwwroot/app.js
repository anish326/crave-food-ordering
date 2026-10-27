const $ = (selector) => document.querySelector(selector);
const money = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const isRestaurantPage = location.pathname.endsWith('/restaurant.html');
const pageRestaurantId = new URLSearchParams(location.search).get('id');
const state = { menu: [], restaurants: [], selectedRestaurantId: isRestaurantPage ? pageRestaurantId : null, cuisine: 'All', restaurantSearch: '', category: 'All', search: '', cart: readCart() };
const storedFavorites = readSaved('fork-flame-favorites',[]);
const storedHistory = readSaved('fork-flame-history',[]);
const storedProfile = readSaved('fork-flame-profile',{});
const experience = {favorites:Array.isArray(storedFavorites) ? storedFavorites.filter(id => typeof id === 'string').slice(0,100) : [],history:Array.isArray(storedHistory) ? storedHistory.filter(order => order && typeof order.id === 'string' && typeof order.email === 'string').slice(0,20) : [],profile:storedProfile && typeof storedProfile === 'object' && !Array.isArray(storedProfile) ? storedProfile : {},address:'',mode:'delivery',sort:'recommended',onlyFavorites:false,promoCode:readSession('crave-promo',''),quote:null,submitting:false,requestId:null};
experience.address = typeof experience.profile.address === 'string' ? experience.profile.address : readSession('crave-address','');
try { if (!experience.history.length) { const id = localStorage.getItem('fork-flame-last-order'), email = localStorage.getItem('fork-flame-last-email'); if (id && email) experience.history = [{id,email}]; } } catch {}
const photos = {
  'burger-classic':'savory tl', 'burger-spicy':'more tl', 'burger-veggie':'savory tl',
  'pizza-margherita':'savory tr', 'pizza-pepperoni':'savory tr',
  'bowl-grain':'savory bl', 'bowl-chicken':'savory bl',
  'side-fries':'savory br', 'side-wings':'savory br',
  'drink-lemonade':'more tr', 'drink-cola':'more bl', 'dessert-cookie':'more br',
  'ember-margherita':'savory tr', 'ember-pepperoni':'savory tr', 'ember-cookie':'more br',
  'green-grain':'savory bl', 'green-chicken':'savory bl', 'green-veggie':'savory bl', 'green-lemonade':'more tr'
};
let previewMode = location.protocol === 'file:';
let activeDialog = null;
let previousFocus = null;
let trackedOrder = null;
let trackingTimer = null;

function readCart() {
  try {
    const saved = JSON.parse(localStorage.getItem('fork-flame-cart') || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch { return {}; }
}
function saveCart() { try { localStorage.setItem('fork-flame-cart', JSON.stringify(state.cart)); } catch { /* File previews may block storage. */ } }
function cartLines() { return state.menu.filter(item => Number.isInteger(state.cart[item.id]) && state.cart[item.id] > 0).map(item => ({ item, quantity: Math.min(state.cart[item.id], 20) })); }
function currentRestaurant() { return state.restaurants.find(restaurant => restaurant.id === state.selectedRestaurantId); }
function cartRestaurantId() { return cartLines()[0]?.item.restaurantId || null; }
function restaurantName(id) { return state.restaurants.find(restaurant => restaurant.id === id)?.name || (id === 'fork-flame' ? 'Fork & Flame' : 'Restaurant'); }
function subtotal() { return cartLines().reduce((sum, line) => sum + line.item.price * line.quantity, 0); }
function count() { return cartLines().reduce((sum, line) => sum + line.quantity, 0); }

function renderCategories() {
  if (!$('#categories')) return;
  const categories = ['All', ...new Set(state.menu.filter(item => item.restaurantId === state.selectedRestaurantId).map(item => item.category))];
  $('#categories').innerHTML = categories.map(category => `<button type="button" class="${state.category === category ? 'active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('');
}
function renderMenu() {
  if (!$('#menu-grid')) return;
  const term = state.search.toLowerCase().trim();
  const items = state.menu.filter(item => item.restaurantId === state.selectedRestaurantId && (state.category === 'All' || item.category === state.category) && `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(term));
  $('#menu-count').textContent = `${items.length} delicious ${items.length === 1 ? 'choice' : 'choices'}`;
  $('#menu-grid').innerHTML = items.length ? items.map(item => `<article class="food-card"><div class="food-image ${photos[item.id] ? `photo ${photos[item.id]}` : 'fallback'}">${item.popular ? '<span class="popular">MOST LOVED</span>' : ''}<span class="food-emoji" aria-hidden="true">${escapeHtml(item.emoji)}</span></div><div class="food-body"><span class="food-category">${escapeHtml(item.category)}</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description)}</p><div class="food-bottom"><span class="food-price">${money(item.price)}</span><button type="button" class="add-button" data-add="${escapeHtml(item.id)}" aria-label="Add ${escapeHtml(item.name)} to cart">+</button></div></div></article>`).join('') : '<p class="empty-menu">No dishes found. Try another search.</p>';
}
function renderRestaurants() {
  if (!$('#restaurant-grid')) return;
  const cuisines = ['All', ...new Set(state.restaurants.map(restaurant => restaurant.cuisine.split(' · ')[0]))];
  $('#cuisine-filters').innerHTML = cuisines.map(cuisine => `<button type="button" data-cuisine="${escapeHtml(cuisine)}" class="${state.cuisine === cuisine ? 'active' : ''}">${escapeHtml(cuisine)}</button>`).join('');
  const term = state.restaurantSearch.toLowerCase().trim();
  const restaurants = state.restaurants.filter(restaurant => (state.cuisine === 'All' || restaurant.cuisine.toLowerCase().includes(state.cuisine.toLowerCase())) && (!experience.onlyFavorites || experience.favorites.includes(restaurant.id)) && (!term || `${restaurant.name} ${restaurant.cuisine} ${restaurant.tagline} ${state.menu.filter(item => item.restaurantId === restaurant.id).map(item => item.name).join(' ')}`.toLowerCase().includes(term)));
  const averagePrice = restaurant => { const dishes = state.menu.filter(item => item.restaurantId === restaurant.id); return dishes.length ? dishes.reduce((sum,item) => sum + item.price,0)/dishes.length : Infinity; };
  if (experience.sort === 'prep') restaurants.sort((a,b) => a.prepMinutes - b.prepMinutes);
  if (experience.sort === 'price') restaurants.sort((a,b) => averagePrice(a) - averagePrice(b));
  if (experience.sort === 'name') restaurants.sort((a,b) => a.name.localeCompare(b.name));
  $('#restaurant-count').textContent = `${restaurants.length} ${restaurants.length === 1 ? 'KITCHEN' : 'KITCHENS'} TO EXPLORE`;
  $('#restaurant-grid').innerHTML = restaurants.length ? restaurants.map((restaurant, index) => `<article class="restaurant-card ${escapeHtml(restaurant.accent)} ${restaurant.id === state.selectedRestaurantId ? 'selected' : ''}"><a class="restaurant-open" href="${restaurantUrl(restaurant.id)}" data-select-restaurant="${escapeHtml(restaurant.id)}"><div class="restaurant-photo ${escapeHtml(restaurant.imageKey)}"><span class="photo-number">0${index + 1} / DISCOVER</span><span class="restaurant-arrow">↗</span></div><div class="restaurant-card-body"><span class="restaurant-cuisine">${escapeHtml(restaurant.cuisine)}</span><h3>${escapeHtml(restaurant.name)}</h3>${ratingMarkup(restaurant.id)}<p>${escapeHtml(restaurant.tagline)}</p><div class="restaurant-meta"><span>◷ &nbsp; About ${restaurant.prepMinutes} min prep</span><strong>VIEW MENU ↗</strong></div><div class="restaurant-metrics">${Number.isFinite(averagePrice(restaurant)) ? `${money(averagePrice(restaurant))} average dish · ` : ''}${experience.mode === 'pickup' ? 'Free pickup' : '$3.99 delivery · free at $30'}</div></div></a><button type="button" class="favorite-button ${experience.favorites.includes(restaurant.id) ? 'saved' : ''}" data-favorite="${escapeHtml(restaurant.id)}" aria-pressed="${experience.favorites.includes(restaurant.id)}" aria-label="${experience.favorites.includes(restaurant.id) ? 'Unsave' : 'Save'} ${escapeHtml(restaurant.name)}">${experience.favorites.includes(restaurant.id) ? '♥' : '♡'}</button></article>`).join('') : '<p class="no-restaurants">No kitchens match these filters. Try another search or turn off Saved kitchens.</p>';
}

function restaurantUrl(id) { return '/restaurant.html?id=' + encodeURIComponent(id); }
function renderRestaurantHeader() {
  const restaurant = currentRestaurant();
  if (!isRestaurantPage || !restaurant) return;
  const saved = experience.favorites.includes(restaurant.id);
  $('#selected-restaurant').innerHTML = `<div class="restaurant-cover ${escapeHtml(restaurant.imageKey)}" aria-hidden="true"></div><div class="restaurant-heading"><div class="section-kicker">${escapeHtml(restaurant.cuisine)}</div><h1>${escapeHtml(restaurant.name)}</h1>${ratingMarkup(restaurant.id)}<p>${escapeHtml(restaurant.tagline)}</p><div class="restaurant-facts"><span>◷ &nbsp; About ${restaurant.prepMinutes} min prep</span><span>${experience.mode === 'pickup' ? '⌂ &nbsp; Free pickup' : '↗ &nbsp; $3.99 delivery · free at $30'}</span><span>Pay on arrival</span></div><button type="button" class="restaurant-save ${saved ? 'saved' : ''}" data-favorite="${escapeHtml(restaurant.id)}" aria-pressed="${saved}">${saved ? '♥ Saved kitchen' : '♡ Save this kitchen'}</button></div>`;
  $('#restaurant-breadcrumb-name').textContent = restaurant.name;
  document.title = restaurant.name + ' menu | Crave';
}
function selectRestaurant(id, scroll = true) {
  if (!state.restaurants.some(restaurant => restaurant.id === id)) return;
  if (!isRestaurantPage || pageRestaurantId !== id) { window.location.assign(restaurantUrl(id)); return; }
  state.selectedRestaurantId = id;
  state.category = 'All'; state.search = ''; $('#search').value = '';
  renderRestaurantHeader();
  $('#menu-intro').textContent = 'Choose your favorites from ' + currentRestaurant().name;
  renderCategories(); renderMenu(); syncServiceMode();
  if (scroll) $('#menu').scrollIntoView({behavior:'smooth'});
}
function showRestaurantUnavailable(message) {
  if (!isRestaurantPage) return;
  $('#selected-restaurant').hidden = true;
  $('#menu').hidden = true;
  const panel = $('#restaurant-page-message');
  panel.hidden = false;
  panel.innerHTML = `<span class="section-kicker">KITCHEN UNAVAILABLE</span><h1>Let’s find another favorite.</h1><p>${escapeHtml(message)}</p><a class="button button-dark" href="/#restaurants">BROWSE RESTAURANTS ↗</a>`;
  document.title = 'Restaurant unavailable | Crave';
}

function renderCart() {
  if (typeof renderRecommendations === "function") renderRecommendations();
  const lines = cartLines();
  document.body.classList.toggle('has-bag',!!lines.length);
  $('#cart-count').textContent = count();
  $('#drawer-count').textContent = `(${count()})`;
  $('#cart-subtotal').textContent = money(subtotal());
  $('#cart-restaurant').textContent = cartRestaurantId() ? `From ${restaurantName(cartRestaurantId())}` : 'One kitchen at a time';
  $('#checkout-button').disabled = lines.length === 0;
  $('#floating-bag').hidden = !lines.length || !!activeDialog;
  $('#floating-count').textContent = count() + (count() === 1 ? ' item' : ' items');
  $('#floating-total').textContent = money(subtotal());
  $('#bag-progress').innerHTML = lines.length ? '<p>' + (subtotal() >= 30 ? 'Free delivery unlocked.' : money(30 - subtotal()) + ' away from free delivery.') + '</p><div><i style="width:' + Math.min(100,subtotal()/30*100) + '%"></i></div>' : '';
  $('#cart-items').innerHTML = lines.length ? lines.map(({ item, quantity }) => `<div class="cart-line"><div class="cart-line-emoji ${photos[item.id] ? `photo ${photos[item.id]}` : ''}">${photos[item.id] ? '' : escapeHtml(item.emoji)}</div><div><h3>${escapeHtml(item.name)}</h3><small>${money(item.price)} each</small><div><span class="quantity"><button type="button" data-decrease="${escapeHtml(item.id)}" aria-label="Decrease ${escapeHtml(item.name)} quantity">−</button>${quantity}<button type="button" data-increase="${escapeHtml(item.id)}" aria-label="Increase ${escapeHtml(item.name)} quantity">+</button></span><button class="remove-line" type="button" data-remove="${escapeHtml(item.id)}">Remove</button></div></div><span class="cart-line-price">${money(item.price * quantity)}</span></div>`).join('') : '<div class="empty-cart"><span>🛍️</span><h3>Your bag is empty</h3><p>The good stuff is waiting on the menu.</p></div>';
}
function setQuantity(id, quantity) {
  if (!experience.submitting) experience.requestId = null;
  if (!state.menu.some(item => item.id === id)) return;
  if (quantity <= 0) delete state.cart[id];
  else state.cart[id] = Math.min(quantity, 20);
  saveCart(); renderCart(); renderCheckoutTotals();
}
function openDialog(selector) {
  const restoreTarget = activeDialog ? previousFocus : document.activeElement;
  closeDialogs(false);
  previousFocus = restoreTarget;
  activeDialog = $(selector);
  $('#scrim').hidden = false;
  activeDialog.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#floating-bag').hidden = true;
  activeDialog.querySelector('button, input')?.focus();
}
function closeDialogs(restoreFocus = true) {
  document.querySelectorAll('.drawer, .modal').forEach(dialog => dialog.hidden = true);
  $('#scrim').hidden = true;
  document.body.style.overflow = '';
  activeDialog = null;
  if (state.menu.length) $('#floating-bag').hidden = !count();
  clearInterval(trackingTimer);
  trackingTimer = null;
  if (restoreFocus) previousFocus?.focus();
}
function deliveryFee() { return $('#checkout-form [name="fulfillment"]')?.value === 'delivery' && subtotal() < 30 ? 3.99 : 0; }
function updateFulfillment() {
  if (!experience.submitting) experience.requestId = null;
  $('#checkout-form [name="fulfillment"]').value = 'delivery';
  $('#address-field').hidden = false;
  $('#checkout-form [name="address"]').required = true;
  syncServiceMode(); renderCheckoutTotals();
}

async function submitOrder(event) {
  event.preventDefault();
  if (experience.submitting) return;
  const button = $('#place-order');
  const message = $('#checkout-message');
  message.textContent = '';
  if (previewMode) { message.textContent = 'Preview only: launch Start-FoodOrder.cmd and open http://localhost:5000 to place an order.'; return; }
  if (!cartLines().length) { message.textContent = 'Add something to your cart first.'; return; }
  if (!experience.quote) { message.textContent = 'Please wait for the price quote or fix the message above.'; return; }
  const form = event.currentTarget;
  const data = new FormData(form);
  const body = {
    fulfillment: data.get('fulfillment'),
    restaurantId: cartRestaurantId(),
    promoCode: experience.promoCode || null,
    tip: Number($('#checkout-tip').value),
    customer: { name: data.get('name'), email: data.get('email'), phone: data.get('phone'), address: data.get('address'), notes: data.get('notes') },
    items: cartLines().map(({ item, quantity }) => ({ id: item.id, quantity }))
  };
  experience.submitting = true;
  experience.requestId ||= crypto.randomUUID();
  body.clientRequestId = experience.requestId;
  body.expectedTotal = experience.quote.total;
  button.disabled = true;
  button.textContent = 'Placing your order…';
  try {
    const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { if (response.status === 409) await renderCheckoutTotals(); throw new Error(result.error || 'Could not place your order.'); }
    try { localStorage.setItem('fork-flame-last-order', result.id); localStorage.setItem('fork-flame-last-email', body.customer.email); } catch { /* Order still succeeds. */ }
    experience.requestId = null;
    rememberOrder(result, body.customer.email);
    experience.address = body.customer.address?.trim() || experience.address; saveSession('crave-address',experience.address);
    experience.profile = $('#remember-details').checked ? {name:body.customer.name,email:body.customer.email,phone:body.customer.phone,address:experience.address} : {};
    persist('fork-flame-profile',experience.profile);
    experience.promoCode = ''; saveSession('crave-promo',''); $('#promo-code').value = '';
    state.cart = {}; saveCart(); renderCart();
    form.reset(); updateFulfillment();
    $('#success-code').textContent = result.id;
    $('#success-detail').textContent = `${result.restaurantName || restaurantName(result.restaurantId)} · ${result.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'} · ${money(result.total)} · Pay on arrival`;
    openDialog('#success-modal');
  } catch (error) { message.textContent = error.message || 'Something went wrong. Please try again.'; }
  finally { experience.submitting = false; button.disabled = !experience.quote; button.innerHTML = 'Place order <span>↗</span>'; }
}

function mapMarkup(order) {
  if (order.fulfillment !== 'delivery') return '';
  const location = order.courierLocation;
  if (order.status === 'Cancelled') return '';
  if (!location || order.status !== 'Out for delivery') return `<div class="tracking-map waiting-map"><div class="map-waiting"><span class="map-pin">⌖</span><strong>${order.status === 'Completed' ? 'Delivery complete' : 'Map activates when your courier is on the way'}</strong><small>${order.status === 'Completed' ? 'Your order has arrived.' : 'Status updates appear above. No live location has been shared yet.'}</small></div></div>`;
  const lat = Number(location.latitude), lon = Number(location.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return '';
  const delta = 0.012;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].map(value => value.toFixed(6)).join('%2C');
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
  const updated = new Date(location.updatedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  return `<div class="tracking-map"><iframe title="Latest shared courier location" src="${mapUrl}" loading="lazy" referrerpolicy="no-referrer"></iframe></div><p class="map-caption">Courier location shared at ${escapeHtml(updated)}. Updates appear when staff shares a new position. Map © OpenStreetMap contributors.</p>`;
}

function renderTrackedOrder(order) {
  const steps = order.fulfillment === 'delivery' ? ['Placed','Preparing','Ready','Out for delivery','Completed'] : ['Placed','Preparing','Ready','Completed'];
  const current = steps.indexOf(order.status);
  const timeline = progressMarkup(order);
  const canCancel = ['Placed','Preparing'].includes(order.status);
  $('#track-result').innerHTML = `<div class="tracked-order"><div class="tracking-header"><span class="status">${escapeHtml(order.status)}</span><span class="tracking-code">#${escapeHtml(order.id)}</span></div><h3>${escapeHtml(order.restaurantName || restaurantName(order.restaurantId))}</h3><p>${escapeHtml(order.fulfillment === 'delivery' ? 'Delivery to ' + order.address : 'Pickup')} · Placed ${new Date(order.placedAt).toLocaleString()}</p>${timeline}<div id="track-preparation">${preparationMarkup(order)}</div>${mapMarkup(order)}<div class="tracking-summary"><ul>${order.items.map(item => `<li>${item.quantity} × ${escapeHtml(item.name)}</li>`).join('')}</ul><div class="receipt-mini"><div><span>Food</span><span>${money(order.subtotal)}</span></div><div><span>Delivery</span><span>${money(order.deliveryFee)}</span></div>${order.discount ? `<div><span>Savings</span><span>−${money(order.discount)}</span></div>` : ''}<div><span>Tip</span><span>${money(order.tip || 0)}</span></div><strong>Total ${money(order.total)}</strong></div></div><button type="button" class="receipt-button" data-receipt>DOWNLOAD RECEIPT ↗</button>${canCancel ? '<button class="cancel-order-button" id="cancel-order" type="button">Cancel order</button><p class="cancel-note">You can cancel until your order is ready.</p>' : ''}<p class="form-message" id="cancel-message" role="alert"></p></div>`;
  renderReviewForm(order);
}

async function loadTrackedOrder(silent = false) {
  const id = $('#track-code').value.trim().toUpperCase();
  const email = $('#track-email').value.trim();
  const message = $('#track-message');
  if (!silent) { message.textContent = ''; $('#track-result').innerHTML = ''; }
  if (previewMode) { message.textContent = 'Launch Start-FoodOrder.cmd and open http://localhost:5000 to track an order.'; return; }
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(id)}?email=${encodeURIComponent(email)}`);
    if (!response.ok) throw new Error(response.status === 404 ? 'No order found with that code and email.' : 'Could not look up the order.');
    const order = await response.json();
    const changed = !trackedOrder || trackedOrder.id !== order.id || JSON.stringify([trackedOrder.status,trackedOrder.courierLocation]) !== JSON.stringify([order.status,order.courierLocation]);
    notifyOrderChange(order);
    rememberOrder(order,email);
    trackedOrder = order;
    if (changed || !silent) renderTrackedOrder(order);
    if (!silent) { clearInterval(trackingTimer); trackingTimer = setInterval(() => { if (activeDialog === $('#track-modal')) loadTrackedOrder(true); }, 15000); }
  } catch (error) { if (!silent) message.textContent = error.message || 'Please try again.'; }
}

async function trackOrder(event) {
  event.preventDefault();
  await loadTrackedOrder();
}

document.addEventListener('click', (event) => {
  const cuisine = event.target.closest('[data-cuisine]');
  if (cuisine) { state.cuisine = cuisine.dataset.cuisine; renderRestaurants(); return; }
  const cancel = event.target.closest('#cancel-order');
  if (cancel && trackedOrder && confirm('Cancel this order? This cannot be undone.')) {
    cancel.disabled = true;
    fetch(`/api/orders/${encodeURIComponent(trackedOrder.id)}/cancel`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('#track-email').value.trim()})})
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Cancellation failed.'); trackedOrder = data; renderTrackedOrder(data); })
      .catch(error => { $('#cancel-message').textContent = error.message; cancel.disabled = false; });
    return;
  }
  const category = event.target.closest('[data-category]');
  if (category) { state.category = category.dataset.category; renderCategories(); renderMenu(); }
  const add = event.target.closest('[data-add]');
  if (add) {
    const item = state.menu.find(entry => entry.id === add.dataset.add);
    const currentCartRestaurant = cartRestaurantId();
    if (!item) return;
    if (currentCartRestaurant && currentCartRestaurant !== item.restaurantId) {
      if (!confirm(`Your bag has food from ${restaurantName(currentCartRestaurant)}. Start a new bag for ${restaurantName(item.restaurantId)}?`)) return;
      state.cart = {}; saveCart(); renderCart();
    }
    setQuantity(item.id, (state.cart[item.id] || 0) + 1); openDialog('#cart-drawer');
  }
  const increase = event.target.closest('[data-increase]');
  if (increase) setQuantity(increase.dataset.increase, (state.cart[increase.dataset.increase] || 0) + 1);
  const decrease = event.target.closest('[data-decrease]');
  if (decrease) setQuantity(decrease.dataset.decrease, (state.cart[decrease.dataset.decrease] || 0) - 1);
  const remove = event.target.closest('[data-remove]');
  if (remove) setQuantity(remove.dataset.remove, 0);
  if (event.target.closest('[data-close]') || event.target === $('#scrim')) closeDialogs();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeDialog) closeDialogs();
  if (event.key === 'Tab' && activeDialog) {
    const focusable = [...activeDialog.querySelectorAll('button:not(:disabled),input:not([type="hidden"]),textarea,select,a[href]')].filter(element => !element.closest('[hidden]'));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
$('#cart-button').addEventListener('click', () => openDialog('#cart-drawer'));
$('#checkout-button').addEventListener('click', openCheckout);
function openTracking() { try { $('#track-code').value = localStorage.getItem('fork-flame-last-order') || ''; $('#track-email').value = localStorage.getItem('fork-flame-last-email') || ''; } catch { $('#track-code').value = ''; $('#track-email').value = ''; } trackedOrder = null; $('#track-result').innerHTML = ''; $('#track-message').textContent = ''; openDialog('#track-modal'); if ($('#track-code').value && $('#track-email').value) loadTrackedOrder(); }

$('#success-track').addEventListener('click', openTracking);
$('#search')?.addEventListener('input', (event) => { state.search = event.target.value; renderMenu(); });
$('#restaurant-search')?.addEventListener('input', (event) => { state.restaurantSearch = event.target.value; renderRestaurants(); });

$('#checkout-form').addEventListener('submit', submitOrder);
$('#track-form').addEventListener('submit', trackOrder);

async function loadMenu() {
  try {
    if (previewMode) { state.menu = (window.previewMenu || []).map(item => ({...item,restaurantId:'fork-flame'})); state.restaurants = [{id:'fork-flame',name:'Fork & Flame',cuisine:'Burgers · Comfort food',tagline:'Big flavor, made for every craving.',prepMinutes:25,imageKey:'burger',accent:'coral'}]; }
    else {
      const [menuResponse, restaurantResponse] = await Promise.all([fetch('/api/menu'),fetch('/api/restaurants')]);
      if (!menuResponse.ok || !restaurantResponse.ok) throw new Error();
      state.menu = await menuResponse.json(); state.restaurants = await restaurantResponse.json();
    }
    for (const id of Object.keys(state.cart)) {
      if (!state.menu.some(item => item.id === id) || !Number.isInteger(state.cart[id]) || state.cart[id] < 1) delete state.cart[id];
      else state.cart[id] = Math.min(state.cart[id], 20);
    }
    $('#checkout-form [name="fulfillment"]').value = 'delivery';
    saveCart();
    if (isRestaurantPage) {
      if (state.restaurants.some(restaurant => restaurant.id === pageRestaurantId)) selectRestaurant(pageRestaurantId,false);
      else showRestaurantUnavailable('This restaurant is not currently accepting orders, or the menu link is invalid.');
    } else renderRestaurants();
    renderCart(); updateFulfillment();
    if (isRestaurantPage && new URLSearchParams(location.search).get('bag') === '1' && count()) openDialog('#cart-drawer');
    if (previewMode) {
      const notice = document.createElement('div'); notice.className = 'preview-notice';
      notice.textContent = 'Visual preview · Launch the C# application to browse all kitchens, order and track.';
      document.querySelector('.site-header').after(notice);
    }
  } catch {
    if (isRestaurantPage) showRestaurantUnavailable('The menu could not be loaded. Please refresh or return to restaurants.');
    else $('#restaurant-grid').innerHTML = '<p class="empty-menu">Restaurants are unavailable right now. Please refresh to try again.</p>';
  }
}

function readSession(key, fallback) { try { return sessionStorage.getItem(key) || fallback; } catch { return fallback; } }
function saveSession(key, value) { try { sessionStorage.setItem(key,value); } catch {} }
function readSaved(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch { return fallback; } }
function persist(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Browsing and checkout work without storage. */ } }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(experience.toastTimer); experience.toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function syncServiceMode() {
  experience.mode = 'delivery'; saveSession('crave-mode','delivery');
  $('#delivery-location small').textContent = 'DELIVER TO';
  $('#delivery-location-text').textContent = experience.address || 'Add delivery address';
  if (state.restaurants.length) renderRestaurants();
  if (isRestaurantPage && currentRestaurant()) renderRestaurantHeader();
}

let quoteVersion = 0;
async function renderCheckoutTotals() {
  const version = ++quoteVersion;
  experience.quote = null;
  $('#place-order').disabled = true;
  if (!cartLines().length) return;
  $('#checkout-subtotal').textContent = money(subtotal());
  $('#checkout-delivery').textContent = 'Calculating…';
  $('#checkout-total').textContent = '…';
  $('#checkout-message').textContent = '';
  if (previewMode) { $('#checkout-message').textContent = 'Start the C# app to calculate totals and place an order.'; return; }
  try {
    const response = await fetch('/api/checkout/quote', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({restaurantId:cartRestaurantId(),fulfillment:$('#checkout-form [name="fulfillment"]').value,items:cartLines().map(({item,quantity}) => ({id:item.id,quantity})),promoCode:experience.promoCode || null,tip:Number($('#checkout-tip').value)})});
    const data = await response.json();
    if (version !== quoteVersion) return;
    if (!response.ok) throw new Error(data.error || 'Could not calculate the total.');
    experience.quote = data;
    $('#checkout-subtotal').textContent = money(data.subtotal);
    $('#checkout-delivery').textContent = data.deliveryFee ? money(data.deliveryFee) : 'Free';
    $('#checkout-discount-row').hidden = !data.discount;
    $('#checkout-discount').textContent = `−${money(data.discount)}`;
    $('#checkout-tip-total').textContent = money(data.tip);
    $('#checkout-total').textContent = money(data.total);
    $('#checkout-estimate').textContent = `About ${data.prepMinutes} minutes to prepare. ${experience.mode === 'delivery' ? 'Travel time depends on the delivery address.' : 'Check order status before collecting.'}`;
    $('#promo-message').textContent = data.promoCode ? `${data.promoCode} applied. You save ${money(data.discount)}.` : 'FRESH10: 10% off a $20+ food subtotal, up to $8.';
    $('#place-order').disabled = false;
  } catch (error) { if (version === quoteVersion) { $('#checkout-message').textContent = error.message || 'Unable to connect. Please try again.'; $('#checkout-total').textContent = 'Unavailable'; } }
}
function rememberOrder(order, email) {
  if (typeof notifyOrderChange === "function") notifyOrderChange(order);
  const entry = {id:order.id,email,restaurantId:order.restaurantId,restaurantName:order.restaurantName || restaurantName(order.restaurantId),placedAt:order.placedAt,total:order.total,status:order.status,items:order.items};
  experience.history = [entry,...experience.history.filter(item => item.id !== order.id)].sort((a,b) => new Date(b.placedAt) - new Date(a.placedAt)).slice(0,20);
  persist('fork-flame-history',experience.history);
}
function renderHistory() {
  $('#history-list').innerHTML = experience.history.length ? experience.history.map(order => `<article class="history-order"><header><div><h3>${escapeHtml(order.restaurantName || 'Saved order')}</h3><small>#${escapeHtml(order.id)}${order.placedAt ? ` · ${escapeHtml(new Date(order.placedAt).toLocaleDateString())}` : ''}</small></div><span class="history-status">${escapeHtml(order.lookupError ? 'Could not refresh' : order.status || 'Saved')}</span></header><p>${(order.items || []).map(item => `${item.quantity} × ${escapeHtml(item.name)}`).join(' · ') || 'Open tracking to see the details.'}</p><footer><button type="button" data-history-track="${escapeHtml(order.id)}">TRACK ORDER</button><button type="button" data-reorder="${escapeHtml(order.id)}" ${order.items?.length ? '' : 'disabled'}>ORDER AGAIN</button><strong>${Number.isFinite(order.total) ? money(order.total) : ''}</strong></footer></article>`).join('') : '<div class="history-empty">Your next favorite is waiting.<br>Orders you place on this device will appear here.</div>';
  $('#clear-history').hidden = !experience.history.length;
}
async function openHistory() {
  openDialog('#history-modal'); renderHistory();
  const refs = [...experience.history];
  await Promise.all(refs.map(async entry => {
    try { const response = await fetch(`/api/orders/${encodeURIComponent(entry.id)}?email=${encodeURIComponent(entry.email)}`); if (!response.ok) throw new Error(); const order = await response.json(); if (experience.history.some(saved => saved.id === entry.id)) rememberOrder(order,entry.email); }
    catch { const saved = experience.history.find(order => order.id === entry.id); if (saved) saved.lookupError = true; }
  }));
  if (activeDialog === $('#history-modal')) renderHistory();
}
async function reorder(id) {
  const order = experience.history.find(entry => entry.id === id);
  if (!order) return;
  try {
    const [menuResponse, restaurantResponse] = await Promise.all([fetch('/api/menu'),fetch('/api/restaurants')]);
    if (!menuResponse.ok || !restaurantResponse.ok) throw new Error('Could not refresh the menu. Try again.');
    const menu = await menuResponse.json(), restaurants = await restaurantResponse.json();
    if (!restaurants.some(restaurant => restaurant.id === order.restaurantId)) throw new Error('This restaurant is not taking orders right now.');
    const available = (order.items || []).filter(item => menu.some(dish => dish.id === item.id && dish.restaurantId === order.restaurantId));
    if (!available.length) throw new Error('These dishes are no longer available. Please choose from the current menu.');
    if (count() && !confirm('Replace your current bag with this order? Current prices will apply.')) return;
    state.menu = menu; state.restaurants = restaurants; state.cart = Object.fromEntries(available.map(item => [item.id,Math.min(20,Math.max(1,item.quantity))]));
    saveCart();
    if (!isRestaurantPage || pageRestaurantId !== order.restaurantId) { window.location.assign(restaurantUrl(order.restaurantId) + '&bag=1'); return; }
    selectRestaurant(order.restaurantId,false); renderCart(); renderCheckoutTotals(); openDialog('#cart-drawer');
    toast(available.length < order.items.length ? 'Available dishes added. Unavailable dishes were left out. Current prices apply.' : 'Your favorites are in the bag. Current prices apply.');
  } catch (error) { toast(error.message); }
}
function downloadReceipt() {
  if (!trackedOrder) return;
  const o = trackedOrder;
  const text = ['CRAVE — ORDER RECEIPT',o.restaurantName || restaurantName(o.restaurantId),`Order: ${o.id}`,`Placed: ${new Date(o.placedAt).toLocaleString()}`,`Status: ${o.status}`,`Fulfillment: ${o.fulfillment}`,'',...o.items.map(item => `${item.quantity} x ${item.name} — ${money(item.unitPrice * item.quantity)}`),'',`Food subtotal: ${money(o.subtotal)}`,`Delivery: ${money(o.deliveryFee)}`,`Promo savings: -${money(o.discount || 0)}`,`Tip: ${money(o.tip || 0)}`,`Total: ${money(o.total)}`,'Payment: Pay on arrival',o.status === 'Cancelled' ? 'ORDER CANCELLED — no payment is due.' : 'No online payment has been collected.'].join('\n');
  const url = URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})); const link = document.createElement('a'); link.href = url; link.download = `Crave-${o.id}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
function orderTiming(order) {
  if (!order.estimatedReadyAt || ['Cancelled','Completed','Out for delivery','Ready'].includes(order.status)) return '';
  const ready = new Date(order.estimatedReadyAt);
  return `<p class="receipt-estimate">${ready > new Date() ? `Estimated food ready around ${escapeHtml(ready.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}.` : 'The preparation estimate has passed. Please check the latest status above.'} This is a kitchen estimate.</p>`;
}
function openCheckout() {
  const form = $('#checkout-form');
  for (const field of ['name','email','phone','address']) if (experience.profile[field]) form.elements[field].value = experience.profile[field];
  if (experience.address) form.elements.address.value = experience.address;
  $('#remember-details').checked = Object.keys(experience.profile).some(key => experience.profile[key]);
  $('#promo-code').value = experience.promoCode;
  openDialog('#checkout-modal'); renderCheckoutTotals();
}
document.addEventListener('click', event => {
  if (event.target.closest('a[href="#top"]')) { event.preventDefault(); window.scrollTo({top:0,behavior:'smooth'}); }
  const favorite = event.target.closest('[data-favorite]');
  if (favorite) { const id = favorite.dataset.favorite; experience.favorites = experience.favorites.includes(id) ? experience.favorites.filter(entry => entry !== id) : [...experience.favorites,id]; persist('fork-flame-favorites',experience.favorites); renderRestaurants(); if (isRestaurantPage) renderRestaurantHeader(); return; }
  if (event.target.closest('[data-open-history]')) openHistory();
  const track = event.target.closest('[data-history-track]');
  if (track) { const order = experience.history.find(entry => entry.id === track.dataset.historyTrack); if (!order) return; openDialog('#track-modal'); trackedOrder = null; $('#track-code').value = order.id; $('#track-email').value = order.email; loadTrackedOrder(); }
  const again = event.target.closest('[data-reorder]');
  if (again && !again.disabled) reorder(again.dataset.reorder);
  if (event.target.closest('[data-receipt]')) downloadReceipt();
});
$('#restaurant-sort')?.addEventListener('change',event => { experience.sort = event.target.value; renderRestaurants(); });
$('#favorites-filter')?.addEventListener('click',event => { experience.onlyFavorites = !experience.onlyFavorites; event.currentTarget.setAttribute('aria-pressed',experience.onlyFavorites); renderRestaurants(); });
$('#floating-bag').addEventListener('click',() => openDialog('#cart-drawer'));
$('#apply-promo').addEventListener('click',() => { experience.promoCode = $('#promo-code').value.trim().toUpperCase(); saveSession('crave-promo',experience.promoCode); if (!experience.submitting) experience.requestId = null; renderCheckoutTotals(); });
$('#checkout-tip').addEventListener('change',() => { if (!experience.submitting) experience.requestId = null; renderCheckoutTotals(); });
$('#use-offer')?.addEventListener('click',() => { experience.promoCode = 'FRESH10'; saveSession('crave-promo',experience.promoCode); $('#promo-code').value = 'FRESH10'; toast('FRESH10 is ready at checkout. Add $20 of food to use it.'); ($('#restaurants') || $('#menu')).scrollIntoView({behavior:'smooth'}); });
$('#clear-history').addEventListener('click',() => { if (!confirm('Clear the order history saved on this device? Your restaurant orders will remain on the server.')) return; experience.history = []; persist('fork-flame-history',[]); try { localStorage.removeItem('fork-flame-last-order'); localStorage.removeItem('fork-flame-last-email'); } catch {} renderHistory(); });
$('#delivery-location').addEventListener('click',() => { const form = $('#delivery-details-form'); form.elements.deliveryAddress.value = experience.address; form.elements.rememberAddress.checked = !!experience.profile.address; openDialog('#address-modal'); });
$('#delivery-details-form').addEventListener('submit',event => { event.preventDefault(); const form = event.currentTarget; experience.address = form.elements.deliveryAddress.value.trim(); saveSession('crave-address',experience.address); if (!experience.address) return; if (form.elements.rememberAddress.checked) experience.profile.address = experience.address; else delete experience.profile.address; persist('fork-flame-profile',experience.profile); $('[name="address"]').value = experience.address; $('#checkout-form [name="fulfillment"]').value = 'delivery'; updateFulfillment(); closeDialogs(); toast('Delivery address updated.'); });
$('#forget-details').addEventListener('click',() => { experience.profile = {}; experience.address = ''; saveSession('crave-address',''); persist('fork-flame-profile',{}); for(const field of ['name','email','phone','address']) $('#checkout-form').elements[field].value = ''; $('#delivery-details-form').reset(); $('#remember-details').checked = false; syncServiceMode(); toast('Saved contact and address forgotten.'); });

$('#checkout-form').addEventListener('input',() => { if (!experience.submitting) experience.requestId = null; });
$('#promo-code').addEventListener('keydown',event => { if (event.key === 'Enter') { event.preventDefault(); $('#apply-promo').click(); } });
$('#promo-code').addEventListener('change',() => $('#apply-promo').click());
window.addEventListener('pageshow',event => { if (event.persisted) { state.cart = readCart(); loadMenu(); } });
loadMenu();
