/*
 * The theme's own script, on every page: the drawers (bag, menu, search), the bag's count and lines (Shopify's AJAX cart
 * with the Section Rendering API), the product page's options and add to bag, and the header over the estate's exterior.
 * The estate (sgla-estate.js, home page only) talks to it through window events:
 *   sgla:aside-open / sgla:aside-close  ->  a drawer opens or closes; sgla:aside-state <- which one is open
 *   sgla:cart-added (the cart's answer)  ->  the bag drawer is redrawn; sgla:cart <- the bag's count
 *   sgla:location                        <- the address changed without a page load (the wardrobe link on the home page)
 */
(() => {
  'use strict';

  const DRAWER_SECTION = 'sgla-cart-drawer';
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  // the shop's root (a language or market prefix included), as Shopify gives it to the page
  const base = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  const routes = {cartChange: `${base}cart/change.js`, cartAdd: `${base}cart/add.js`, suggest: `${base}search/suggest.json`};

  /* ---- drawers ------------------------------------------------------------------------------------------------------ */
  let openType = 'closed';
  let opener = null;
  const drawer = (type) => document.querySelector(`[data-sgla-drawer="${type}"]`);

  function announce() {
    window.dispatchEvent(new CustomEvent('sgla:aside-state', {detail: openType}));
  }

  function openDrawer(type) {
    const element = drawer(type);
    if (!element) return false;
    if (openType !== 'closed' && openType !== type) closeDrawer(false);
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.classList.add('expanded');
    openType = type;
    announce();
    // the first field (search), else the close button, once the drawer's visibility transition has started (a hidden
    // element cannot take focus); again a little later on a busy page (the estate drawing its first wardrobe frames)
    const focusFirst = () => {
      if (openType !== type || element.contains(document.activeElement)) return;
      const first = element.querySelector('input[type="search"]') || element.querySelector('.close');
      if (first) first.focus({preventScroll: true});
    };
    window.setTimeout(focusFirst, 60);
    window.setTimeout(focusFirst, 250);
    return true;
  }

  function closeDrawer(restoreFocus = true) {
    if (openType === 'closed') return;
    const element = drawer(openType);
    if (element) element.classList.remove('expanded');
    openType = 'closed';
    announce();
    if (restoreFocus && opener && document.contains(opener)) opener.focus({preventScroll: true});
    opener = null;
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const close = target.closest('[data-sgla-close]');
    if (close) {
      event.preventDefault();
      closeDrawer();
      return;
    }
    const open = target.closest('[data-sgla-open]');
    if (open && openDrawer(open.getAttribute('data-sgla-open'))) event.preventDefault();
  });

  document.addEventListener('keydown', (event) => {
    if (openType === 'closed') return;
    if (event.key === 'Escape') {
      // the estate leaves on Escape too, unless a drawer is open above it: the drawer takes the key
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const element = drawer(openType);
    const items = element ? [...element.querySelectorAll('aside ' + FOCUSABLE.split(', ').join(', aside '))].filter((el) => el.offsetParent !== null) : [];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.addEventListener('sgla:aside-open', (event) => openDrawer(event.detail));
  window.addEventListener('sgla:aside-close', () => closeDrawer());

  /* ---- the bag -------------------------------------------------------------------------------------------------------- */
  function setCount(count) {
    for (const element of document.querySelectorAll('[data-sgla-count]')) element.textContent = String(count);
    for (const element of document.querySelectorAll('[data-sgla-bag]')) {
      element.setAttribute('aria-label', `Bag, ${count} ${count === 1 ? 'item' : 'items'}`);
    }
    window.dispatchEvent(new CustomEvent('sgla:cart', {detail: {item_count: count}}));
  }

  /** The drawer's lines and summary, from the section markup a cart request answered with. */
  function redraw(sections) {
    const html = sections && sections[DRAWER_SECTION];
    if (!html) return refresh();
    const next = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-sgla-cart-body]');
    const body = document.querySelector('[data-sgla-cart-body]');
    if (!next || !body) return refresh();
    body.innerHTML = next.innerHTML;
    setCount(Number(next.getAttribute('data-count') || 0));
  }

  /** The drawer and the count read again (after a change the answer did not carry). */
  async function refresh() {
    try {
      const response = await fetch(`${window.location.pathname}?sections=${DRAWER_SECTION}`, {headers: {Accept: 'application/json'}});
      if (response.ok) redraw(await response.json());
    } catch (error) {
      console.warn('The bag could not be read again', error);
    }
  }

  window.addEventListener('sgla:cart-added', (event) => redraw(event.detail && event.detail.sections));

  async function changeLine(form, quantity) {
    const line = Number(form.querySelector('input[name="line"]').value);
    form.setAttribute('aria-busy', 'true');
    for (const button of form.querySelectorAll('button')) button.disabled = true;
    try {
      const response = await fetch(routes.cartChange, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({line, quantity, sections: DRAWER_SECTION, sections_url: window.location.pathname}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.description || body.message || `HTTP ${response.status}`);
      redraw(body.sections);
    } catch (error) {
      console.warn('The bag could not be changed', error);
      await refresh();
    }
  }

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    // the drawer's quantity buttons: changed in place (the bag page keeps the plain form, which reloads the page)
    if (form.matches('[data-sgla-cart-body] [data-sgla-line]')) {
      event.preventDefault();
      const submitter = event.submitter;
      if (submitter && submitter.name === 'quantity') void changeLine(form, Number(submitter.value));
      return;
    }
    if (form.matches('[data-sgla-product-form]')) {
      event.preventDefault();
      void addProduct(form);
    }
  });

  /* ---- the product page ------------------------------------------------------------------------------------------------ */
  function productOf(form) {
    const container = form.closest('[data-sgla-product]');
    const json = container && container.querySelector('[data-sgla-product-json]');
    try {
      return json ? JSON.parse(json.textContent) : null;
    } catch {
      return null;
    }
  }

  const money = (cents) => {
    const currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'USD';
    try {
      return new Intl.NumberFormat(document.documentElement.lang || undefined, {style: 'currency', currency}).format(cents / 100);
    } catch {
      return (cents / 100).toFixed(2);
    }
  };

  function selectVariant(form) {
    const product = productOf(form);
    if (!product) return;
    const chosen = product.options.map((_, index) => {
      const selected = form.querySelector(`.product-options-item.is-selected[data-option-index="${index}"]`);
      return selected ? selected.getAttribute('data-option-value') : null;
    });
    const variant =
      product.variants.find((v) => v.options.every((value, i) => chosen[i] === null || chosen[i] === value)) || null;
    const container = form.closest('[data-sgla-product]');
    const add = form.querySelector('[data-sgla-add]');
    const id = form.querySelector('[data-sgla-variant-id]');
    const price = container.querySelector('[data-sgla-price]');
    // option values no variant has with the other choices are shown as unavailable
    for (const button of form.querySelectorAll('.product-options-item')) {
      const index = Number(button.getAttribute('data-option-index'));
      const value = button.getAttribute('data-option-value');
      const match = product.variants.find((v) => v.options[index] === value && v.options.every((o, i) => i === index || chosen[i] === null || chosen[i] === o));
      button.classList.toggle('is-unavailable', !match || !match.available);
    }
    if (!variant) {
      add.disabled = true;
      add.textContent = 'Unavailable';
      return;
    }
    id.value = variant.id;
    add.disabled = !variant.available;
    add.textContent = variant.available ? 'Add to bag' : 'Sold out';
    if (price) {
      price.innerHTML =
        variant.compare_at_price && variant.compare_at_price > variant.price
          ? `<div class="product-price-on-sale">${money(variant.price)}<s>${money(variant.compare_at_price)}</s></div>`
          : money(variant.price);
    }
    const image = container.querySelector('[data-sgla-product-image]');
    if (image && variant.featured_image && variant.featured_image.src) {
      image.removeAttribute('srcset');
      image.src = variant.featured_image.src;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('variant', variant.id);
    window.history.replaceState(window.history.state, '', url);
  }

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-sgla-product-form] .product-options-item') : null;
    if (!button) return;
    for (const sibling of button.closest('.product-options-grid').querySelectorAll('.product-options-item')) {
      const selected = sibling === button;
      sibling.classList.toggle('is-selected', selected);
      sibling.setAttribute('aria-pressed', String(selected));
    }
    selectVariant(button.closest('form'));
  });

  async function addProduct(form) {
    const add = form.querySelector('[data-sgla-add]');
    const error = form.querySelector('[data-sgla-product-error]');
    const label = add.textContent;
    add.disabled = true;
    add.setAttribute('aria-busy', 'true');
    add.textContent = 'Adding';
    if (error) error.hidden = true;
    try {
      const id = Number(form.querySelector('[data-sgla-variant-id]').value);
      const response = await fetch(routes.cartAdd, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({items: [{id, quantity: 1}], sections: DRAWER_SECTION, sections_url: window.location.pathname}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.description || body.message || 'The piece could not be added.');
      redraw(body.sections);
      openDrawer('cart');
    } catch (problem) {
      if (error) {
        error.textContent = problem instanceof Error ? problem.message : 'The piece could not be added.';
        error.hidden = false;
      }
    } finally {
      add.disabled = false;
      add.removeAttribute('aria-busy');
      add.textContent = label;
    }
  }

  /* ---- search suggestions -------------------------------------------------------------------------------------------------- */
  let searchTimer = 0;
  document.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.closest('[data-sgla-search]')) return;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void suggest(input.value.trim()), 220);
  });

  async function suggest(terms) {
    const results = document.querySelector('[data-sgla-suggestions]');
    if (!results) return;
    if (terms.length < 2) {
      results.innerHTML = '';
      return;
    }
    try {
      const query = new URLSearchParams({q: terms, 'resources[type]': 'product', 'resources[limit]': '6'});
      const response = await fetch(`${routes.suggest}?${query}`, {headers: {Accept: 'application/json'}});
      if (!response.ok) return;
      const body = await response.json();
      const products = (body.resources && body.resources.results && body.resources.results.products) || [];
      const list = document.createElement('ul');
      for (const product of products) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = product.url;
        if (product.image) {
          const image = document.createElement('img');
          image.src = product.image;
          image.alt = '';
          image.width = 56;
          image.height = 56;
          image.loading = 'lazy';
          link.append(image);
        }
        const title = document.createElement('span');
        title.textContent = product.title;
        link.append(title);
        item.append(link);
        list.append(item);
      }
      results.replaceChildren(products.length ? list : Object.assign(document.createElement('p'), {textContent: `No results for "${terms}"`}));
    } catch (error) {
      console.warn('Search suggestions could not be read', error);
    }
  }

  /* ---- the header over the estate, and the wardrobe link on the home page ----------------------------------------------- */
  const header = document.querySelector('[data-sgla-header][data-home]');
  if (header) {
    const update = () => header.classList.toggle('header--over-hero', window.scrollY < 8);
    update();
    window.addEventListener('scroll', update, {passive: true});
  }

  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[data-sgla-wardrobe]') : null;
    // on the home page the estate opens in place (its address is ?view=wardrobe), as the storefront's link does
    if (!link || !document.getElementById('sgla-estate') || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    closeDrawer(false);
    const url = new URL(link.href, window.location.href);
    window.history.pushState(null, '', `${url.pathname}${url.search}`);
    window.dispatchEvent(new Event('sgla:location'));
  });
})();
