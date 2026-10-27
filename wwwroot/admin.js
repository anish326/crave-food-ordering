const $ = selector => document.querySelector(selector);
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const money = amount => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(amount);
const state = { csrf:'', orders:[], menu:[], restaurants:[], tab:'orders' };
const restaurantName = id => state.restaurants.find(restaurant => restaurant.id === id)?.name || (id === 'fork-flame' ? 'Fork & Flame' : 'Restaurant');

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { ...(options.body ? {'Content-Type':'application/json'} : {}), ...(method !== 'GET' && state.csrf ? {'X-Admin-CSRF':state.csrf} : {}), ...(options.headers || {}) };
  let response;
  try { response = await fetch(path, { ...options, method, headers }); }
  catch { throw new Error('Could not connect to the server.'); }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/admin/login') showLogin();
    throw new Error(data?.error || (response.status === 401 ? 'Incorrect password or expired session.' : `Request failed (${response.status}).`));
  }
  return data;
}

function showLogin() {
  state.csrf = '';
  $('#login-view').hidden = false;
  $('#dashboard').hidden = true;
  $('#logout').hidden = true;
}
function showDashboard() {
  $('#login-view').hidden = true;
  $('#dashboard').hidden = false;
  $('#logout').hidden = false;
}
function selectTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.side-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `${tab}-panel`));
  if (tab === 'orders') loadOrders();
  if (tab === 'restaurants') loadRestaurants();
  if (tab === 'menu') loadMenu();
  if (tab === 'analytics') { setupAnalyticsFilters(); loadAnalytics(); }
}

function nextStatuses(order) {
  if (order.status === 'Placed') return ['Preparing','Cancelled'];
  if (order.status === 'Preparing') return ['Ready','Cancelled'];
  if (order.status === 'Ready') return order.fulfillment === 'delivery' ? ['Out for delivery','Cancelled'] : ['Completed','Cancelled'];
  if (order.status === 'Out for delivery') return ['Completed','Cancelled'];
  return [];
}
function statusClass(status) {
  if (status === 'Completed') return 'completed';
  if (status === 'Cancelled') return 'cancelled';
  if (status === 'Out for delivery') return 'out';
  return status.toLowerCase();
}
function renderOrders() {
  const orders = state.orders;
  $('#stat-new').textContent = orders.filter(order => order.status === 'Placed').length;
  $('#stat-progress').textContent = orders.filter(order => ['Preparing','Ready','Out for delivery'].includes(order.status)).length;
  $('#stat-completed').textContent = orders.filter(order => order.status === 'Completed').length;
  $('#stat-total').textContent = money(orders.filter(order => order.status !== 'Cancelled').reduce((sum, order) => sum + order.total, 0));
  $('#open-count').textContent = orders.filter(order => !['Completed','Cancelled'].includes(order.status)).length;
  const filter = $('#order-filter').value;
  const visible = orders.filter(order => filter === 'all' || (filter === 'active' ? !['Completed','Cancelled'].includes(order.status) : order.status === filter));
  $('#orders-list').innerHTML = visible.length ? visible.map(order => `<article class="order-card"><div class="order-top"><div><span class="order-id">#${safe(order.id)} · ${safe(order.restaurantName || restaurantName(order.restaurantId))}</span><h3>${safe(order.customerName)}</h3><p>${new Date(order.placedAt).toLocaleString()}</p></div><div><span class="status-pill ${statusClass(order.status)}">${safe(order.status.toUpperCase())}</span><p style="margin-top:9px">${safe(order.fulfillment === 'delivery' ? 'Delivery' : 'Pickup')}</p></div><div><strong>${money(order.total)}</strong><p>${order.items.length} ${order.items.length === 1 ? 'item' : 'items'}</p></div><div><button class="outline-button" type="button" data-expand="${safe(order.id)}">DETAILS</button></div></div><div class="order-detail" id="detail-${safe(order.id)}" hidden><div><strong>ORDER ITEMS</strong><ul>${order.items.map(item => `<li>${item.quantity} × ${safe(item.name)} · ${money(item.unitPrice * item.quantity)}</li>`).join('')}</ul><p>Subtotal ${money(order.subtotal)} · Delivery ${money(order.deliveryFee)} · Savings ${money(order.discount || 0)} · Tip ${money(order.tip || 0)}${order.promoCode ? ` · Promo ${safe(order.promoCode)}` : ''}</p></div><div><strong>CUSTOMER DETAILS</strong><p>${safe(order.email)}<br>${safe(order.phone)}${order.address ? `<br>${safe(order.address)}` : ''}${order.notes ? `<br>Notes: ${safe(order.notes)}` : ''}</p></div></div>${order.fulfillment === 'delivery' && order.status === 'Out for delivery' ? `<div class="courier-tools"><div><strong>COURIER LOCATION</strong><p>${order.courierLocation ? `Last shared ${new Date(order.courierLocation.updatedAt).toLocaleString()}` : 'Share the courier’s position to activate the customer map.'}</p></div><button type="button" data-share-location="${safe(order.id)}">USE MY LOCATION</button><form data-location-form="${safe(order.id)}"><input type="number" step="any" min="-90" max="90" name="latitude" aria-label="Courier latitude" placeholder="Latitude" required><input type="number" step="any" min="-180" max="180" name="longitude" aria-label="Courier longitude" placeholder="Longitude" required><button type="submit">SET PIN</button></form></div>` : ''}${nextStatuses(order).length ? `<div class="order-actions">${nextStatuses(order).map(status => `<button type="button" class="${status === 'Cancelled' ? 'cancel-action' : ''}" data-status="${safe(status)}" data-order="${safe(order.id)}">${status === 'Cancelled' ? 'CANCEL ORDER' : `MARK ${safe(status.toUpperCase())}`}</button>`).join('')}</div>` : ''}</article>`).join('') : '<div class="empty-state">No orders in this view yet.</div>';
}
async function loadOrders() {
  try { state.orders = await api('/api/admin/orders'); $('#orders-message').textContent = ''; renderOrders(); }
  catch (error) { $('#orders-message').textContent = error.message; }
}
function renderMenu() {
  $('#item-count').textContent = `${state.menu.length} items`;
  $('#admin-menu-list').innerHTML = state.menu.length ? state.menu.map(item => `<article class="admin-menu-row"><div class="menu-emoji">${safe(item.emoji)}</div><div class="menu-main"><strong>${safe(item.name)}</strong><small>${safe(restaurantName(item.restaurantId))} · ${safe(item.category)} · ${safe(item.description)}</small></div><div class="menu-price">${money(item.price)}</div><span class="availability ${item.available ? '' : 'off'}">${item.available ? 'AVAILABLE' : 'PAUSED'}</span><div class="menu-row-actions"><button type="button" data-edit="${safe(item.id)}">Edit</button><button type="button" data-toggle="${safe(item.id)}">${item.available ? 'Pause' : 'Resume'}</button><button type="button" data-delete="${safe(item.id)}">Delete</button></div></article>`).join('') : '<div class="empty-state">Your menu is empty. Add the first item.</div>';
}
async function loadMenu() {
  try { state.menu = await api('/api/admin/menu'); $('#menu-message').textContent = ''; renderMenu(); }
  catch (error) { $('#menu-message').textContent = error.message; }
}
function renderRestaurants() {
  $('#restaurant-admin-count').textContent = `${state.restaurants.length} kitchens`;
  $('#admin-restaurants-list').innerHTML = state.restaurants.length ? state.restaurants.map(restaurant => `<article class="admin-restaurant-row"><div class="admin-restaurant-photo ${safe(restaurant.imageKey)}"></div><div class="admin-restaurant-main"><span>${safe(restaurant.cuisine)}</span><h3>${safe(restaurant.name)}</h3><p>${safe(restaurant.tagline)} · About ${restaurant.prepMinutes} min prep</p></div><span class="availability ${restaurant.available ? '' : 'off'}">${restaurant.available ? 'ACCEPTING ORDERS' : 'PAUSED'}</span><div class="menu-row-actions"><button type="button" data-edit-restaurant="${safe(restaurant.id)}">Edit</button><button type="button" data-toggle-restaurant="${safe(restaurant.id)}">${restaurant.available ? 'Pause' : 'Resume'}</button></div></article>`).join('') : '<div class="empty-state">Add your first restaurant.</div>';
}
async function loadRestaurants() {
  try { state.restaurants = await api('/api/admin/restaurants'); $('#restaurants-message').textContent = ''; renderRestaurants(); if (state.menu.length) renderMenu(); }
  catch (error) { $('#restaurants-message').textContent = error.message; }
}
function openRestaurantEditor(restaurant = null) {
  const form = $('#restaurant-form');
  form.reset();
  form.elements.id.value = restaurant?.id || '';
  form.elements.name.value = restaurant?.name || '';
  form.elements.cuisine.value = restaurant?.cuisine || '';
  form.elements.tagline.value = restaurant?.tagline || '';
  form.elements.prepMinutes.value = restaurant?.prepMinutes || 25;
  form.elements.imageKey.value = restaurant?.imageKey || 'burger';
  form.elements.accent.value = restaurant?.accent || 'coral';
  form.elements.available.checked = restaurant?.available ?? true;
  $('#restaurant-title').textContent = restaurant ? 'Edit restaurant' : 'New restaurant';
  $('#restaurant-error').textContent = '';
  $('#restaurant-backdrop').hidden = false;
  form.elements.name.focus();
}
function closeRestaurantEditor() { $('#restaurant-backdrop').hidden = true; }
function openEditor(item = null) {
  const form = $('#item-form');
  form.reset();
  form.elements.id.value = item?.id || '';
  $('#item-restaurant').innerHTML = state.restaurants.map(restaurant => `<option value="${safe(restaurant.id)}">${safe(restaurant.name)}</option>`).join('');
  form.elements.restaurantId.value = item?.restaurantId || state.restaurants[0]?.id || '';
  form.elements.name.value = item?.name || '';
  form.elements.category.value = item?.category || '';
  form.elements.description.value = item?.description || '';
  form.elements.price.value = item?.price ?? '';
  form.elements.emoji.value = item?.emoji || '';
  form.elements.available.checked = item?.available ?? true;
  form.elements.popular.checked = item?.popular ?? false;
  $('#item-title').textContent = item ? 'Edit menu item' : 'New menu item';
  $('#item-error').textContent = '';
  $('#item-backdrop').hidden = false;
  form.elements.name.focus();
}
function closeEditor() { $('#item-backdrop').hidden = true; }

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (location.protocol === 'file:') { $('#login-error').textContent = 'Launch Start-FoodOrder.cmd and open http://localhost:5000/admin.html to sign in.'; return; }
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  $('#login-error').textContent = '';
  try {
    const session = await api('/api/admin/login', { method:'POST', body:JSON.stringify({ password:$('#login-password').value }) });
    state.csrf = session.csrf;
    $('#login-password').value = '';
    showDashboard();
    await loadRestaurants(); await loadOrders();
  } catch (error) { $('#login-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/admin/logout', {method:'POST'}); } catch { /* Hide staff data even if the request fails. */ } state.orders = []; state.menu = []; state.restaurants = []; showLogin(); });
document.querySelectorAll('.side-tab').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
$('#refresh-orders').addEventListener('click', loadOrders);
$('#order-filter').addEventListener('change', renderOrders);
$('#add-restaurant').addEventListener('click', () => openRestaurantEditor());
$('#close-restaurant').addEventListener('click', closeRestaurantEditor);
$('#cancel-restaurant').addEventListener('click', closeRestaurantEditor);
$('#restaurant-backdrop').addEventListener('click', event => { if (event.target === $('#restaurant-backdrop')) closeRestaurantEditor(); });
$('#admin-restaurants-list').addEventListener('click', async event => {
  const edit = event.target.closest('[data-edit-restaurant]');
  if (edit) { openRestaurantEditor(state.restaurants.find(restaurant => restaurant.id === edit.dataset.editRestaurant)); return; }
  const toggle = event.target.closest('[data-toggle-restaurant]');
  if (!toggle) return;
  const restaurant = state.restaurants.find(entry => entry.id === toggle.dataset.toggleRestaurant);
  if (!restaurant) return;
  toggle.disabled = true;
  try { await api(`/api/admin/restaurants/${encodeURIComponent(restaurant.id)}`, {method:'PUT',body:JSON.stringify({...restaurant,available:!restaurant.available})}); await loadRestaurants(); }
  catch (error) { $('#restaurants-message').textContent = error.message; toggle.disabled = false; }
});
$('#restaurant-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const id = form.elements.id.value;
  const restaurant = {name:form.elements.name.value,cuisine:form.elements.cuisine.value,tagline:form.elements.tagline.value,prepMinutes:Number(form.elements.prepMinutes.value),imageKey:form.elements.imageKey.value,accent:form.elements.accent.value,available:form.elements.available.checked};
  button.disabled = true; $('#restaurant-error').textContent = '';
  try { await api(id ? `/api/admin/restaurants/${encodeURIComponent(id)}` : '/api/admin/restaurants', {method:id ? 'PUT':'POST',body:JSON.stringify(restaurant)}); closeRestaurantEditor(); await loadRestaurants(); }
  catch (error) { $('#restaurant-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#orders-list').addEventListener('click', async event => {
  const expand = event.target.closest('[data-expand]');
  if (expand) { const detail = document.getElementById(`detail-${expand.dataset.expand}`); detail.hidden = !detail.hidden; return; }
  const share = event.target.closest('[data-share-location]');
  if (share) {
    if (!navigator.geolocation) { $('#orders-message').textContent = 'This browser cannot access your location. Enter coordinates in the order card instead.'; return; }
    share.disabled = true;
    navigator.geolocation.getCurrentPosition(async position => {
      try { await saveCourierLocation(share.dataset.shareLocation, position.coords.latitude, position.coords.longitude); }
      catch (error) { $('#orders-message').textContent = error.message; }
      finally { share.disabled = false; }
    }, error => { $('#orders-message').textContent = `${error.message} Enter coordinates in the order card instead.`; share.disabled = false; }, {enableHighAccuracy:true,timeout:12000});
    return;
  }
  const action = event.target.closest('[data-status]');
  if (!action) return;
  action.disabled = true;
  try { await api(`/api/admin/orders/${encodeURIComponent(action.dataset.order)}/status`, { method:'PATCH', body:JSON.stringify({status:action.dataset.status}) }); await loadOrders(); }
  catch (error) { $('#orders-message').textContent = error.message; action.disabled = false; }
});
async function saveCourierLocation(id, latitude, longitude) {
  await api(`/api/admin/orders/${encodeURIComponent(id)}/location`, {method:'PUT',body:JSON.stringify({latitude,longitude})});
  await loadOrders();
}
$('#orders-list').addEventListener('submit', async event => {
  const form = event.target.closest('[data-location-form]');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  try { await saveCourierLocation(form.dataset.locationForm, Number(form.elements.latitude.value), Number(form.elements.longitude.value)); }
  catch (error) { $('#orders-message').textContent = error.message; button.disabled = false; }
});
$('#add-item').addEventListener('click', () => openEditor());
$('#close-item').addEventListener('click', closeEditor);
$('#cancel-item').addEventListener('click', closeEditor);
$('#item-backdrop').addEventListener('click', event => { if (event.target === $('#item-backdrop')) closeEditor(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#item-backdrop').hidden) closeEditor(); if (event.key === 'Escape' && !$('#restaurant-backdrop').hidden) closeRestaurantEditor(); });
$('#admin-menu-list').addEventListener('click', async event => {
  const edit = event.target.closest('[data-edit]');
  if (edit) { openEditor(state.menu.find(item => item.id === edit.dataset.edit)); return; }
  const toggle = event.target.closest('[data-toggle]');
  if (toggle) {
    const item = state.menu.find(item => item.id === toggle.dataset.toggle);
    if (!item) return;
    toggle.disabled = true;
    try { await api(`/api/admin/menu/${encodeURIComponent(item.id)}`, { method:'PUT', body:JSON.stringify({ ...item, available:!item.available }) }); await loadMenu(); }
    catch (error) { $('#menu-message').textContent = error.message; toggle.disabled = false; }
    return;
  }
  const remove = event.target.closest('[data-delete]');
  if (!remove) return;
  const item = state.menu.find(entry => entry.id === remove.dataset.delete);
  if (!item || !confirm(`Delete ${item.name} from the menu? Existing orders will keep their item details.`)) return;
  try { await api(`/api/admin/menu/${encodeURIComponent(item.id)}`, { method:'DELETE' }); await loadMenu(); }
  catch (error) { $('#menu-message').textContent = error.message; }
});
$('#item-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const item = { restaurantId:form.elements.restaurantId.value, name:form.elements.name.value, category:form.elements.category.value, description:form.elements.description.value, price:Number(form.elements.price.value), emoji:form.elements.emoji.value, popular:form.elements.popular.checked, available:form.elements.available.checked };
  const id = form.elements.id.value;
  button.disabled = true;
  $('#item-error').textContent = '';
  try { await api(id ? `/api/admin/menu/${encodeURIComponent(id)}` : '/api/admin/menu', {method:id ? 'PUT':'POST',body:JSON.stringify(item)}); closeEditor(); await loadMenu(); }
  catch (error) { $('#item-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#password-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  $('#password-message').textContent = '';
  try { await api('/api/admin/password', {method:'POST',body:JSON.stringify({currentPassword:form.elements.current.value,newPassword:form.elements.next.value})}); form.reset(); showLogin(); $('#login-error').textContent = 'Password updated. Sign in with your new password.'; }
  catch (error) { $('#password-message').textContent = error.message; }
  finally { button.disabled = false; }
});

async function initialize() {
  if (location.protocol === 'file:') { showLogin(); $('#login-error').textContent = 'Visual preview only. Launch Start-FoodOrder.cmd to use the staff dashboard.'; return; }
  try { const session = await api('/api/admin/session'); state.csrf = session.csrf; showDashboard(); await loadRestaurants(); await loadOrders(); }
  catch { showLogin(); }
}
initialize();
setInterval(() => { if (!$('#dashboard').hidden && state.tab === 'orders') loadOrders(); }, 20000);
