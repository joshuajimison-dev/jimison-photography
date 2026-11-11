(function () {
  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Welcome photos loop: a copy of the first photo follows the last one, and once the page
  // settles on that copy it jumps back to the real first photo, so swiping on never ends.
  var welcomeMain = document.querySelector('.welcome-photos');
  if (welcomeMain) {
    var firstSlide = welcomeMain.querySelector('.welcome-photo');
    var loopCopy = firstSlide.cloneNode(true);
    loopCopy.setAttribute('aria-hidden', 'true');
    loopCopy.classList.add('is-loop-copy');
    loopCopy.querySelectorAll('img').forEach(function (im) {
      im.alt = '';
      im.removeAttribute('data-alt-portrait');
      im.removeAttribute('data-alt-landscape');
    });
    welcomeMain.appendChild(loopCopy);
    var settleTimer = 0;
    var loopBack = function () {
      if (window.scrollY >= loopCopy.offsetTop - 2) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    };
    window.addEventListener('scroll', function () {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(loopBack, 140);
    }, { passive: true });
    if ('onscrollend' in window) window.addEventListener('scrollend', loopBack);
  }

  // Welcome photos follow screen orientation, and their descriptions follow along.
  var portraitQuery = window.matchMedia('(orientation: portrait)');
  var swapImgs = document.querySelectorAll('img[data-alt-portrait]');
  if (swapImgs.length) {
    var setAlts = function () {
      swapImgs.forEach(function (img) {
        img.alt = portraitQuery.matches ? img.dataset.altPortrait : img.dataset.altLandscape;
      });
    };
    setAlts();
    portraitQuery.addEventListener('change', setAlts);
  }

  // Welcome type and signature turn black over light photos and stay white over dark ones.
  var overlay = document.querySelector('.welcome-overlay');
  if (overlay) {
    var slides = document.querySelectorAll('.welcome-photo');
    var setContrast = function () {
      var i = Math.min(slides.length - 1, Math.max(0, Math.round(window.scrollY / window.innerHeight)));
      var luma = +(portraitQuery.matches ? slides[i].dataset.lumaPortrait : slides[i].dataset.luma);
      overlay.classList.toggle('on-light', luma > 0.58);
    };
    window.addEventListener('scroll', setContrast, { passive: true });
    window.addEventListener('resize', setContrast);
    portraitQuery.addEventListener('change', setContrast);
    setContrast();
  }

  // Gallery strips: each moves on its own, eases to a stop under the pointer, and loops.
  // A landscape screen shows one tall strip; a portrait screen shows three thinner rows,
  // the middle one running the other way. Only the strips on screen move.
  Array.prototype.forEach.call(document.querySelectorAll('[data-strip]'), function (strip) {
    var frames = strip.querySelectorAll('.frame');
    var loopWidth = function () { return frames[frames.length / 2].offsetLeft - frames[0].offsetLeft; };
    var CRUISE = +strip.dataset.speed * (strip.hasAttribute('data-reverse') ? -1 : 1); // pixels per second
    var pos = 0, speed = reduced ? 0 : CRUISE, holdUntil = 0, lastTime = 0, pointer = null, started = false;
    var wrap = function () {
      var w = loopWidth();
      if (pos >= w) pos -= w;
      if (pos < 0) pos += w;
    };
    // Only real mouse movement holds the strip. A pointer left resting over it after
    // clicking Enter must not freeze it, and a still pointer lets it move on after a while.
    strip.addEventListener('mousemove', function (e) {
      var moved = pointer && (pointer.x !== e.screenX || pointer.y !== e.screenY);
      pointer = { x: e.screenX, y: e.screenY };
      if (moved) holdUntil = Date.now() + 5000;
    });
    strip.addEventListener('mouseleave', function () { holdUntil = 0; pointer = null; });
    strip.addEventListener('touchstart', function () { holdUntil = Infinity; }, { passive: true });
    strip.addEventListener('touchend', function () { holdUntil = Date.now() + 2500; }, { passive: true });
    strip.addEventListener('wheel', function (e) {
      e.preventDefault();
      pos += e.deltaX || e.deltaY;
      wrap();
      strip.scrollLeft = pos;
      holdUntil = Date.now() + 1500;
    }, { passive: false });
    strip.addEventListener('scroll', function () {
      if (Math.abs(strip.scrollLeft - pos) > 2) { pos = strip.scrollLeft; wrap(); }
    }, { passive: true });
    var tick = function (now) {
      var dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
      lastTime = now;
      requestAnimationFrame(tick);
      if (!strip.offsetParent) return; // this layout is hidden at the current orientation
      // Rows start partway through their loops, so photo edges don't line up between rows.
      if (!started) { started = true; pos = loopWidth() * (+strip.dataset.offset || 0); strip.scrollLeft = pos; }
      var active = document.activeElement;
      var paused = reduced || Date.now() < holdUntil || document.querySelector('dialog[open]') ||
        (strip.contains(active) && active.matches('.frame:focus-visible'));
      speed += ((paused ? 0 : CRUISE) - speed) * Math.min(1, dt * 5);
      if (Math.abs(speed) > 0.5) {
        pos += speed * dt;
        wrap();
        strip.scrollLeft = pos;
      }
    };
    requestAnimationFrame(tick);
  });

  // The fixed signature and the top menu turn black over light photos and white over everything
  // else. Each reads the pixels of whatever photo sits behind it, from a small copy cached per image.
  var copies = new WeakMap();
  var copyOf = function (img) {
    var t = copies.get(img);
    if (t && t.src === img.currentSrc) return t;
    var c = document.createElement('canvas');
    c.width = 64;
    c.height = Math.max(1, Math.round((64 * img.naturalHeight) / img.naturalWidth));
    var ctx = c.getContext('2d', { willReadFrequently: true });
    try { ctx.drawImage(img, 0, 0, c.width, c.height); ctx.getImageData(0, 0, 1, 1); } catch (e) { return null; }
    t = { src: img.currentSrc, c: c, ctx: ctx };
    copies.set(img, t);
    return t;
  };
  // Returns the photo under an element and how much a dark layer above that photo dims it.
  var photoBehind = function (el, r) {
    var found = null;
    [0.2, 0.5, 0.8].some(function (fx) {
      var dim = 0;
      document.elementsFromPoint(r.left + r.width * fx, r.top + r.height / 2).some(function (o) {
        if (el.contains(o)) return false;
        if (o.classList.contains('bk-shade')) { dim = Math.max(dim, +getComputedStyle(o).opacity || 0); return false; }
        if (o.tagName !== 'IMG' || !o.complete || !o.naturalWidth || getComputedStyle(o).visibility === 'hidden') return false;
        found = { img: o, dim: dim };
        return true;
      });
      return found;
    });
    return found;
  };
  var lumaBehind = function (el) {
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return 0;
    var hit = photoBehind(el, r);
    if (!hit) return 0; // the dark page itself
    return lumaOf(hit.img, r) * (1 - hit.dim);
  };
  var lumaOf = function (img, r) {
    if (img.classList.contains('bio-backdrop')) return 0.25; // blurred and dimmed behind a bio photo
    var t = copyOf(img);
    if (!t) return 0;
    // Map the element's box onto the photo, allowing for object-fit cropping or letterboxing.
    var ir = img.getBoundingClientRect();
    var sx = ir.width / t.c.width, sy = ir.height / t.c.height, ox = 0, oy = 0;
    var fit = getComputedStyle(img).objectFit;
    if (fit === 'cover' || fit === 'contain') {
      sx = sy = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
      ox = (ir.width - t.c.width * sx) / 2;
      oy = (ir.height - t.c.height * sy) / 2;
      if (fit === 'cover') {
        var pos = getComputedStyle(img).objectPosition.split(' ').map(parseFloat);
        if (pos.length === 2 && !isNaN(pos[0]) && !isNaN(pos[1])) {
          ox = (ir.width - t.c.width * sx) * pos[0] / 100;
          oy = (ir.height - t.c.height * sy) * pos[1] / 100;
        }
      }
    }
    var x0 = Math.max(0, Math.floor((Math.max(r.left, ir.left) - ir.left - ox) / sx));
    var x1 = Math.min(t.c.width, Math.ceil((Math.min(r.right, ir.right) - ir.left - ox) / sx));
    var y0 = Math.max(0, Math.floor((Math.max(r.top, ir.top) - ir.top - oy) / sy));
    var y1 = Math.min(t.c.height, Math.ceil((Math.min(r.bottom, ir.bottom) - ir.top - oy) / sy));
    if (x1 <= x0 || y1 <= y0) return 0;
    var d = t.ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, sum = 0;
    for (var i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4) / 255;
  };
  var logo = document.querySelector('.logo');
  var header = document.querySelector('.site-header');
  var nav = header && header.querySelector('.site-nav');
  if (logo || nav) {
    var queued = false;
    var updateContrast = function () {
      queued = false;
      root.classList.toggle('is-scrolled', window.scrollY > 24);
      if (logo) logo.classList.toggle('on-light', lumaBehind(logo) > 0.55);
      if (nav) header.classList.toggle('on-light', lumaBehind(nav) > 0.55);
    };
    var queueContrast = function () {
      if (!queued) { queued = true; requestAnimationFrame(updateContrast); }
    };
    window.addEventListener('scroll', queueContrast, { passive: true });
    window.addEventListener('resize', queueContrast);
    document.addEventListener('load', queueContrast, true); // a photo behind it finished loading
    // The menu changes shape as the page scrolls, so read again once it has settled.
    if (header) header.addEventListener('transitionend', queueContrast);
    updateContrast();
  }

  // Bio chapters: related photos fan out around the main one as it nears the middle of the screen.
  var fans = document.querySelectorAll('[data-fan]');
  if (fans.length && !reduced) {
    var spreadFans = function () {
      var mid = window.innerHeight / 2;
      fans.forEach(function (f) {
        var r = f.getBoundingClientRect();
        var off = Math.abs(r.top + r.height / 2 - mid) / window.innerHeight; // 0 at the middle
        var p = Math.max(0, Math.min(1, (0.62 - off) / 0.4));
        f.style.setProperty('--p', (p * p * (3 - 2 * p)).toFixed(3));
      });
    };
    window.addEventListener('scroll', function () { requestAnimationFrame(spreadFans); }, { passive: true });
    window.addEventListener('resize', spreadFans);
    spreadFans();
  }

  // The record's countries light up one after another when its map first scrolls into view.
  var record = document.querySelector('[data-record]');
  if (record && !reduced && 'IntersectionObserver' in window && record.getBoundingClientRect().top > window.innerHeight) {
    record.classList.add('will-reveal');
    new IntersectionObserver(function (entries, observer) {
      if (!entries[0].isIntersecting) return;
      record.classList.add('is-seen');
      observer.disconnect();
    }, { threshold: 0.25 }).observe(record.querySelector('.record-map'));
  }

  // Up next and the closing line fade in a step at a time the first time they scroll into view.
  // Anything already on screen when the page opens is left as it is.
  if (!reduced && 'IntersectionObserver' in window) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-reveal]'), function (el) {
      if (el.getBoundingClientRect().top < window.innerHeight) return;
      el.classList.add('will-reveal');
      new IntersectionObserver(function (entries, observer) {
        if (!entries[0].isIntersecting) return;
        el.classList.add('is-seen');
        observer.disconnect();
      }, { threshold: 0.3 }).observe(el);
    });
  }

  // Bio book: while a spread is pinned, its photo pans from Josh toward the landscape and its text
  // arrives a line at a time, both tied to how far the page has scrolled (never to a timer, and the
  // scroll itself is left alone). An IntersectionObserver limits the work to spreads near the
  // screen; one requestAnimationFrame per scroll does the drawing.
  var book = document.querySelector('[data-book]');
  if (book && !reduced) {
    book.classList.add('bk-live');
    var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
    var ease = function (v) { return v * v * (3 - 2 * v); };
    var spreads = Array.prototype.map.call(book.querySelectorAll('[data-bk]'), function (sec) {
      var pan = (sec.dataset.pan || '').split(' ').map(Number);
      return {
        sec: sec, stage: sec.querySelector('.bk-stage'), photo: sec.querySelector('.bk-photo'),
        strip: sec.querySelector('.negative-strip'), film: sec.hasAttribute('data-film'),
        pan: pan.length === 4 ? pan : null, shade: +(sec.dataset.shade || 0.3), near: true
      };
    });
    // Each word gets its own span so the lines can be found wherever the text wraps.
    var paragraphs = Array.prototype.slice.call(book.querySelectorAll('[data-lines]'));
    paragraphs.forEach(function (p) {
      var words = p.textContent.trim().split(/\s+/);
      p.textContent = '';
      words.forEach(function (w, i) {
        var s = document.createElement('span');
        s.className = 'w';
        s.textContent = w;
        p.appendChild(s);
        if (i < words.length - 1) p.appendChild(document.createTextNode(' '));
      });
    });
    var draw = function () {
      spreads.forEach(function (s) {
        if (!s.near) return;
        var r = s.sec.getBoundingClientRect(), vh = s.stage.clientHeight, y = -r.top;
        var reveal = clamp01(y / vh); // 0 while the spread before still covers it
        var life = clamp01(y / r.height); // its whole time on screen, for the pan
        var t = s.film
          ? clamp01((y - 0.45 * vh) / Math.max(1, r.height - 1.45 * vh))
          : clamp01((y - 0.9 * vh) / Math.max(1, (r.height - 2 * vh) * 0.7));
        s.sec.style.setProperty('--t', t.toFixed(3));
        s.sec.style.setProperty('--shade', Math.max((1 - reveal) * 0.55, Math.min(1, t * 2.5) * s.shade).toFixed(3));
        if (s.photo && s.from) {
          var e = ease(life);
          s.photo.style.transform = 'translate3d(' + (s.from[0] + (s.to[0] - s.from[0]) * e).toFixed(1) + 'px,' +
            (s.from[1] + (s.to[1] - s.from[1]) * e).toFixed(1) + 'px,0)';
        }
        if (s.strip) s.strip.style.setProperty('--drift', ((0.5 - life) * 0.08 * vh).toFixed(1) + 'px');
      });
      if (typeof queueContrast === 'function') queueContrast();
    };
    var layout = function () {
      paragraphs.forEach(function (p) {
        var line = 0, top = null;
        Array.prototype.forEach.call(p.querySelectorAll('.w'), function (s) {
          if (top === null) top = s.offsetTop;
          else if (s.offsetTop - top > 4) { line++; top = s.offsetTop; }
          s.style.setProperty('--i', line + 1); // the heading is line 0
        });
        p.parentNode.style.setProperty('--n', line + 2);
      });
      spreads.forEach(function (s) {
        if (!s.photo || !s.pan) return;
        var vw = s.stage.clientWidth, vh = s.stage.clientHeight;
        var ar = s.photo.getAttribute('width') / s.photo.getAttribute('height');
        var w = vw, h = vw / ar;
        if (h < vh) { h = vh; w = vh * ar; }
        var k = Math.max(1, (1.35 * vh) / h); // on tall screens, enlarge a little so there is room to travel
        w *= k; h *= k;
        var at = function (fx, fy) {
          return [Math.min(0, Math.max(vw - w, vw / 2 - fx * w)), Math.min(0, Math.max(vh - h, vh / 2 - fy * h))];
        };
        s.from = at(s.pan[0], s.pan[1]);
        s.to = at(s.pan[2], s.pan[3]);
        s.photo.style.width = w + 'px';
        s.photo.style.height = h + 'px';
      });
      draw();
    };
    var drawQueued = false;
    var queueDraw = function () {
      if (drawQueued) return;
      drawQueued = true;
      requestAnimationFrame(function () { drawQueued = false; draw(); });
    };
    if ('IntersectionObserver' in window) {
      var nearby = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          spreads.forEach(function (s) { if (s.sec === en.target) s.near = en.isIntersecting; });
        });
        queueDraw();
      }, { rootMargin: '100% 0px' });
      spreads.forEach(function (s) { nearby.observe(s.sec); });
    }
    window.addEventListener('scroll', queueDraw, { passive: true });
    window.addEventListener('resize', layout);
    window.addEventListener('load', layout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
    layout();
  }

  // Casual image saving is discouraged. Nothing fully prevents copying.
  document.addEventListener('contextmenu', function (e) {
    if (e.target.tagName === 'IMG') e.preventDefault();
  });

  // Photo viewer, shared by the gallery, collection pages and the world map. It opens on black,
  // then the screen washes into a soft version of the photo's own color. The circles under the
  // photo switch to a gallery wall with a black or oak frame, which holds while browsing.
  var viewer = document.getElementById('viewer');
  if (viewer) {
    var triggers = Array.prototype.slice.call(document.querySelectorAll('[data-photo]'));
    var seen = {};
    var items = triggers.filter(function (t) {
      if (seen[t.dataset.photo]) return false;
      seen[t.dataset.photo] = true;
      return true;
    });
    var index = 0;
    var $ = function (sel) { return viewer.querySelector(sel); };
    var img = $('.mount img');
    var modeButtons = Array.prototype.slice.call(viewer.querySelectorAll('.viewer-modes [data-mode]'));
    var setMode = function (mode) {
      viewer.dataset.mode = mode;
      modeButtons.forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.mode === mode)); });
    };
    modeButtons.forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode); });
    });
    var tint = function (wash, ink) {
      viewer.style.setProperty('--wash', wash);
      viewer.style.setProperty('--ink', ink);
    };
    img.addEventListener('load', function () { img.classList.add('is-ready'); });
    var show = function (i, quiet) {
      index = (i + items.length) % items.length;
      var d = items[index].dataset;
      img.classList.remove('is-ready');
      img.srcset = d.srcset || '';
      img.sizes = '(max-width: 760px) 100vw, calc(100vw - 340px)';
      img.src = d.src;
      img.alt = d.alt;
      if (img.complete && img.naturalWidth) img.classList.add('is-ready');
      if (!quiet) tint(d.wash, d.ink);
      $('.viewer-title').textContent = d.title;
      $('.viewer-location').textContent = d.location || '';
      $('.viewer-location').hidden = !d.location;
      $('.viewer-coords').textContent = d.coords || '';
      $('.viewer-coords').hidden = !d.coords;
      $('.viewer-story').textContent = d.story || '';
      $('.viewer-story').hidden = !d.story;
      $('.viewer-inquire').href = 'contact.html#' + d.photo;
    };
    triggers.forEach(function (t) {
      t.addEventListener('click', function () {
        show(items.findIndex(function (it) { return it.dataset.photo === t.dataset.photo; }), true);
        setMode('open');
        tint('#050606', '#ffffff');
        // Its signature starts white on the black, then turns black as the light wash comes in.
        $('.viewer-sig').classList.remove('on-light');
        viewer.showModal();
        var d = items[index].dataset;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            tint(d.wash, d.ink);
            $('.viewer-sig').classList.add('on-light');
          });
        });
      });
    });
    $('[data-act="prev"]').addEventListener('click', function () { show(index - 1); });
    $('[data-act="next"]').addEventListener('click', function () { show(index + 1); });
    $('[data-act="close"]').addEventListener('click', function () { viewer.close(); });
    viewer.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') show(index - 1);
      if (e.key === 'ArrowRight') show(index + 1);
    });
    // Swipe left or right on the photo to move to the next or previous one.
    var touchStart = null;
    viewer.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { touchStart = null; return; }
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }, { passive: true });
    viewer.addEventListener('touchend', function (e) {
      if (!touchStart || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - touchStart.x, dy = e.changedTouches[0].clientY - touchStart.y;
      var quick = Date.now() - touchStart.t < 800;
      touchStart = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3 && quick) show(index + (dx < 0 ? 1 : -1));
    }, { passive: true });
    // A sideways two-finger scroll on a trackpad does the same, one photo per gesture.
    var wheelSum = 0, wheelLock = 0;
    viewer.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (Date.now() < wheelLock) return;
      wheelSum += e.deltaX;
      if (Math.abs(wheelSum) > 60) {
        show(index + (wheelSum > 0 ? 1 : -1));
        wheelSum = 0;
        wheelLock = Date.now() + 600;
      }
    }, { passive: false });
  }

  // The World: dots and labels sit over an inline map that flies between views.
  var atlas = document.getElementById('atlas');
  if (atlas) {
    var svg = atlas.querySelector('svg');
    var FULL = svg.getAttribute('viewBox').split(' ').map(Number);
    var vb = FULL.slice(), flight = 0;
    var placed = Array.prototype.slice.call(atlas.querySelectorAll('[data-x]'));
    var dots = placed.filter(function (el) { return el.classList.contains('atlas-dot'); });
    var viewButtons = Array.prototype.slice.call(document.querySelectorAll('[data-vb]'));
    var card = atlas.querySelector('.atlas-card');
    var canHover = window.matchMedia('(hover: hover)').matches;

    var draw = function () {
      svg.setAttribute('viewBox', vb.join(' '));
      svg.style.setProperty('--zw', vb[2] / FULL[2]);
      placed.forEach(function (el) {
        var x = (el.dataset.x - vb[0]) / vb[2], y = (el.dataset.y - vb[1]) / vb[3];
        el.style.left = x * 100 + '%';
        el.style.top = y * 100 + '%';
        el.classList.toggle('is-out', x < -0.01 || x > 1.01 || y < -0.01 || y > 1.01);
      });
    };
    // Dots that would overlap in a view fan out into a small ring, so each stays clickable.
    var spread = function (view) {
      var w = atlas.clientWidth, h = atlas.clientHeight, groups = [];
      dots.forEach(function (d) {
        var p = { el: d, x: ((d.dataset.x - view[0]) / view[2]) * w, y: ((d.dataset.y - view[1]) / view[3]) * h };
        var g = groups.find(function (g) { return Math.hypot(g[0].x - p.x, g[0].y - p.y) < 14; });
        if (g) g.push(p); else groups.push([p]);
      });
      groups.forEach(function (g) {
        var r = g.length > 1 ? 5 + g.length * 2 : 0, cx = 0, cy = 0;
        g.forEach(function (p) { cx += p.x / g.length; cy += p.y / g.length; });
        g.forEach(function (p, i) {
          var a = -Math.PI / 2 + (i * 2 * Math.PI) / g.length;
          p.el.style.setProperty('--dx', (cx + r * Math.cos(a) - p.x).toFixed(1) + 'px');
          p.el.style.setProperty('--dy', (cy + r * Math.sin(a) - p.y).toFixed(1) + 'px');
        });
      });
    };
    var hideCard = function () { card.classList.remove('is-on'); };
    var showCard = function (d) {
      if (!canHover) return;
      var img = card.querySelector('img');
      img.src = d.dataset.thumb;
      img.style.aspectRatio = d.dataset.ar;
      card.style.width = (d.dataset.ar >= 1 ? 260 : 170) + 'px';
      card.querySelector('.atlas-card-title').textContent = d.dataset.title;
      card.querySelector('.atlas-card-location').textContent = d.dataset.location;
      var a = atlas.getBoundingClientRect(), r = d.getBoundingClientRect();
      var x = r.left + r.width / 2 - a.left, y = r.top + r.height / 2 - a.top;
      var cw = card.offsetWidth, ch = card.offsetHeight;
      card.style.left = Math.max(0, Math.min(a.width - cw, x - cw / 2)) + 'px';
      card.style.top = (r.top - ch - 16 > 0 ? y - ch - 16 : y + 18) + 'px';
      card.classList.add('is-on');
    };
    var flyTo = function (target) {
      atlas.classList.toggle('is-zoomed', target[2] < FULL[2]);
      spread(target);
      hideCard();
      cancelAnimationFrame(flight);
      if (reduced) { vb = target; draw(); return; }
      var from = vb.slice(), start = performance.now();
      var fc = [from[0] + from[2] / 2, from[1] + from[3] / 2], tc = [target[0] + target[2] / 2, target[1] + target[3] / 2];
      // Between far-apart views the map pulls back on the way, then settles in.
      var lift = Math.max(1, Math.hypot(tc[0] - fc[0], tc[1] - fc[1]) / Math.max(from[2], target[2]));
      var step = function (now) {
        var t = Math.min(1, (now - start) / 1300);
        var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        var w = Math.min(FULL[2], from[2] * Math.pow(target[2] / from[2], e) * Math.pow(lift, Math.sin(Math.PI * e)));
        var h = (w * FULL[3]) / FULL[2];
        var cx = fc[0] + (tc[0] - fc[0]) * e, cy = fc[1] + (tc[1] - fc[1]) * e;
        vb = t < 1 ? [cx - w / 2, cy - h / 2, w, h] : target;
        draw();
        if (t < 1) flight = requestAnimationFrame(step);
      };
      flight = requestAnimationFrame(step);
    };

    viewButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        viewButtons.forEach(function (o) {
          if (o.hasAttribute('aria-pressed')) o.setAttribute('aria-pressed', String(o === b));
        });
        flyTo(b.dataset.vb.split(' ').map(Number));
      });
    });
    dots.forEach(function (d) {
      d.addEventListener('mouseenter', function () { showCard(d); });
      d.addEventListener('focus', function () { showCard(d); });
      d.addEventListener('mouseleave', hideCard);
      d.addEventListener('blur', hideCard);
      d.addEventListener('click', hideCard);
    });
    window.addEventListener('resize', function () { spread(vb); draw(); });
    spread(vb);
    draw();
  }

  // Inquiry form. Sends to formEndpoint once one is configured.
  var form = document.getElementById('inquiry-form');
  if (form) {
    var ref = document.getElementById('inq-ref');
    // Arriving from a photo fills in its title; the catalog ID travels along unseen.
    var hash = location.hash.slice(1);
    if (/^JJ-[A-Z0-9-]+$/.test(hash)) {
      var titles = {};
      try { titles = JSON.parse(document.getElementById('photo-titles').textContent); } catch (e) { /* no titles */ }
      ref.value = titles[hash] || '';
      document.getElementById('inq-id').value = hash;
    }
    var status = document.getElementById('form-status');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var endpoint = form.dataset.endpoint;
      status.hidden = false;
      if (!endpoint) {
        status.textContent = 'Preview only: nothing was sent. This form is not connected yet. After launch, inquiries will go to ' + form.dataset.preview + '.';
        return;
      }
      status.textContent = 'Sending your inquiry…';
      fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: new FormData(form) })
        .then(function (r) {
          if (!r.ok) throw new Error('send failed');
          return r.json().catch(function () { return {}; });
        })
        .then(function (data) {
          if (data && (data.success === false || data.success === 'false')) throw new Error('send failed');
          form.reset();
          status.textContent = 'Thank you. Your inquiry has been sent.';
        })
        .catch(function () {
          status.textContent = 'Your inquiry could not be sent. Please try again, or message Josh on Instagram.';
        });
    });
  }
})();
