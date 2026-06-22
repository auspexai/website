/* verify.js — AuspexAI receipt verifier (vanilla ES6, no imports)
   Calls the coordinator's /api/v0/receipts/verify endpoint and renders results.

   CORS note: coord.auspexai.network allows requests from auspexai.network.
   This will NOT work from file:// origins — use a local HTTP server or deploy. */

(function () {
  'use strict';

  var VERIFY_URL = 'https://coord.auspexai.network/api/v0/receipts/verify';
  var RECEIPT_URL = 'https://coord.auspexai.network/api/v0/receipts/';
  var CERT_URL = 'https://coord.auspexai.network/api/v0/certifications/';
  var CERT_LIST_URL = 'https://coord.auspexai.network/api/v0/certifications';
  var REKOR_ENTRIES = 'https://rekor.sigstore.dev/api/v1/log/entries';

  var textarea = document.getElementById('receipt-input');
  var btn = document.getElementById('verify-btn');
  var resultsSection = document.getElementById('verify-results');
  var stepsContainer = document.getElementById('verify-steps');
  var decodedReceipt = document.getElementById('decoded-receipt');
  var decodedJson = document.getElementById('decoded-json');
  var errorsContainer = document.getElementById('verify-errors');
  var errorList = document.getElementById('error-list');

  btn.addEventListener('click', function () {
    var raw = textarea.value.trim();
    if (!raw) {
      textarea.focus();
      return;
    }
    // Three inputs, auto-detected:
    //  - a receipt id (rcpt-…)            → fetch the receipt blob, verify signature
    //  - a 64-hex package digest          → fetch the published cert, verify + Rekor
    //  - anything else                    → treat as a pasted raw COSE blob
    if (/^rcpt-/i.test(raw)) {
      fetchThenVerify(raw);
    } else if (/^[0-9a-f]{64}$/i.test(raw)) {
      verifyCertificate(raw.toLowerCase());
    } else {
      runVerification(raw.replace(/\s+/g, ''));
    }
  });

  function setLoading(on) {
    btn.disabled = on;
    if (on) {
      btn.classList.add('loading');
    } else {
      btn.classList.remove('loading');
    }
  }

  function clearResults() {
    // Remove previous step rows (keep the heading)
    var heading = stepsContainer.querySelector('.step-heading');
    stepsContainer.innerHTML = '';
    stepsContainer.appendChild(heading);
    decodedJson.textContent = '';
    var dh = decodedReceipt.querySelector('.decoded-heading');
    if (dh) dh.textContent = 'Decoded receipt body';
    errorList.innerHTML = '';
    errorsContainer.classList.remove('visible');
    decodedReceipt.style.display = '';
    resultsSection.classList.remove('visible');
  }

  function renderStep(label, status, detail) {
    // status: 'pass' | 'fail' | 'pending'
    var row = document.createElement('div');
    row.className = 'step-row';

    var icon = document.createElement('span');
    icon.className = 'step-icon ' + status;
    if (status === 'pass') {
      icon.textContent = '✓';
    } else if (status === 'fail') {
      icon.textContent = '✕';
    } else {
      icon.textContent = '—';
    }
    icon.setAttribute('aria-label', status);

    var labelEl = document.createElement('span');
    labelEl.className = 'step-label';
    labelEl.textContent = label;

    row.appendChild(icon);
    row.appendChild(labelEl);

    if (detail) {
      var detailEl = document.createElement('span');
      detailEl.className = 'step-detail';
      detailEl.textContent = detail;
      row.appendChild(detailEl);
    }

    stepsContainer.appendChild(row);
  }

  function renderErrors(errors) {
    if (!errors || errors.length === 0) {
      errorsContainer.classList.remove('visible');
      return;
    }
    errorList.innerHTML = '';
    for (var i = 0; i < errors.length; i++) {
      var li = document.createElement('li');
      li.textContent = errors[i];
      errorList.appendChild(li);
    }
    errorsContainer.classList.add('visible');
  }

  function truncateHex(hex, len) {
    if (!hex) return '';
    len = len || 16;
    if (hex.length <= len) return hex;
    return hex.substring(0, len) + '…';
  }

  function extractMsg(parsed) {
    // Pull a human string out of the coordinator's error body, which may be
    // {detail: "..."} or the nested envelope {detail: {error: {code, message}}}.
    // (Previously this rendered an object as the useless "[object Object]".)
    if (!parsed || typeof parsed !== 'object') return '';
    var d = (parsed.detail !== undefined && parsed.detail !== null) ? parsed.detail : parsed.error;
    if (typeof d === 'string') return d;
    if (d && typeof d === 'object') {
      var e = d.error || d;
      if (typeof e === 'string') return e;
      if (e && (e.message || e.code)) {
        return (e.message || '') + (e.code ? ' (' + e.code + ')' : '');
      }
      try { return JSON.stringify(d); } catch (x) { return ''; }
    }
    return '';
  }

  function fetchThenVerify(receiptId) {
    clearResults();
    setLoading(true);
    fetch(RECEIPT_URL + encodeURIComponent(receiptId), { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (res.status === 404) {
          throw new Error('No receipt found with id "' + receiptId + '".');
        }
        if (!res.ok) {
          throw new Error('Could not fetch the receipt (server returned ' + res.status + ').');
        }
        return res.json();
      })
      .then(function (data) {
        var cose = data.cose_signed_blob_b64;
        if (!cose) {
          throw new Error('That receipt has no signature blob to verify.');
        }
        runVerification(cose);
      })
      .catch(function (err) {
        setLoading(false);
        clearResults();
        resultsSection.classList.add('visible');
        renderErrors([err.message || 'Could not reach the coordinator.']);
      });
  }

  function runVerification(receiptB64) {
    clearResults();
    setLoading(true);

    fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receipt_cose_b64: receiptB64 })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            var msg = 'Server returned ' + res.status;
            // Try to extract a message from JSON response
            try {
              var parsed = JSON.parse(body);
              var detail = extractMsg(parsed);
              if (detail) msg += ': ' + detail;
            } catch (e) {
              if (body) msg += ': ' + body.substring(0, 200);
            }
            throw new Error(msg);
          });
        }
        return res.json();
      })
      .then(function (data) {
        setLoading(false);
        renderResponse(data);
      })
      .catch(function (err) {
        setLoading(false);
        clearResults();
        resultsSection.classList.add('visible');
        renderErrors([err.message || 'Network error — could not reach the coordinator.']);
      });
  }

  function renderResponse(data) {
    resultsSection.classList.add('visible');

    // 1. COSE Decode — if we got a response at all, decoding succeeded
    //    (errors array will contain decode failures if any)
    var hasDecodeError = (data.errors || []).some(function (e) {
      return /decode|cose|cbor|base64|parse/i.test(e);
    });
    renderStep(
      'COSE Decode',
      hasDecodeError ? 'fail' : 'pass'
    );

    // 2. Signature
    var sigStatus = data.signature_valid === true ? 'pass'
                  : data.signature_valid === false ? 'fail'
                  : 'pending';
    var sigDetail = '';
    if (data.signer_kid) {
      sigDetail = 'kid ' + truncateHex(data.signer_kid);
    }
    renderStep('Signature', sigStatus, sigDetail);

    // 3. Schema
    var schemaStatus = data.schema_valid === true ? 'pass'
                     : data.schema_valid === false ? 'fail'
                     : 'pending';
    renderStep('Schema', schemaStatus);

    // 4. Authorized Signer
    var authStatus;
    var authDetail = '';
    if (data.authorized_signer === true) {
      authStatus = 'pass';
      authDetail = 'signer is authorized';
    } else if (data.authorized_signer === false) {
      authStatus = 'fail';
      authDetail = 'signer not authorized';
    } else {
      // null / undefined — the coordinator does not yet perform the roster
      // (AUTHORIZED_SIGNERS.md) check at this endpoint; surface its candid note.
      authStatus = 'pending';
      authDetail = data.authorized_signer_note
        || 'roster check not yet performed by this endpoint';
    }
    renderStep('Authorized Signer', authStatus, authDetail);

    // Coordinator mode (dev vs operational) — so a verifier knows the posture.
    if (data.coordinator_mode) {
      renderStep(
        'Coordinator mode',
        data.coordinator_mode === 'operational' ? 'pass' : 'pending',
        data.coordinator_mode
      );
    }

    // Decoded receipt body
    if (data.receipt && Object.keys(data.receipt).length > 0) {
      decodedJson.textContent = JSON.stringify(data.receipt, null, 2);
      decodedReceipt.style.display = '';
    } else {
      decodedReceipt.style.display = 'none';
    }

    // Errors
    renderErrors(data.errors);
  }

  // ---- Certification verification (RFC 0001 / Research Ethics §6.7) ----------
  // A cert is verified like a receipt — signature + authorized signer — but its
  // trust ANCHOR is PUBLIC Rekor: we fetch the published cert (blob + logIndex)
  // and confirm, against the transparency log we do NOT control, that this exact
  // blob was logged. So the verdict never depends on trusting the coordinator.
  // Verify a cert OBJECT we already hold (a row from the published list, or one
  // fetched by digest). It carries the COSE blob + logIndex; the verdict anchors
  // on the coordinator's signature check + the PUBLIC Rekor inclusion check.
  function verifyCert(cert) {
    clearResults();
    setLoading(true);
    Promise.resolve()
      .then(function () {
        if (!cert.cose_signed_blob_b64) throw new Error('That certification has no signature blob.');
        return fetch(VERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receipt_cose_b64: cert.cose_signed_blob_b64 })
        }).then(function (r) { return r.json(); });
      })
      .then(function (v) {
        return rekorInclusionCheck(cert.cose_signed_blob_b64, cert.rekor_log_index)
          .then(function (rekor) { setLoading(false); renderCertResult({ cert: cert, verify: v, rekor: rekor }); });
      })
      .catch(function (err) {
        setLoading(false);
        clearResults();
        resultsSection.classList.add('visible');
        renderErrors([err.message || 'Could not verify the certification.']);
      });
  }

  // Fetch one cert by its package digest (textarea paste / ?cert= link), then verify.
  function verifyCertificate(digest) {
    setLoading(true);
    fetch(CERT_URL + encodeURIComponent(digest), { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (res.status === 404) throw new Error('No certification found for package ' + digest + '.');
        if (!res.ok) throw new Error('Could not fetch the certification (server returned ' + res.status + ').');
        return res.json();
      })
      .then(function (cert) { verifyCert(cert); })
      .catch(function (err) {
        setLoading(false);
        clearResults();
        resultsSection.classList.add('visible');
        renderErrors([err.message || 'Could not verify the certification.']);
      });
  }

  // The independent step: hash the blob in-browser and compare to the hash the
  // PUBLIC Rekor log recorded at this index. Fetched straight from sigstore — if
  // CORS blocks the browser, we degrade to a pointer the user can open themselves.
  function rekorInclusionCheck(coseB64, logIndex) {
    if (logIndex === null || logIndex === undefined) {
      return Promise.resolve({ status: 'pending', detail: 'not yet anchored in Rekor' });
    }
    return fetch(REKOR_ENTRIES + '?logIndex=' + encodeURIComponent(logIndex))
      .then(function (r) { if (!r.ok) throw new Error('Rekor returned ' + r.status); return r.json(); })
      .then(function (d) {
        var uuid = Object.keys(d)[0];
        var body = JSON.parse(atob(d[uuid].body));
        var anchored = body.spec.data.hash.value;
        return crypto.subtle.digest('SHA-256', b64ToBytes(coseB64)).then(function (buf) {
          var computed = bufToHex(buf);
          return computed === anchored
            ? { status: 'pass', detail: 'logIndex ' + logIndex + ' · blob hash matches the public log' }
            : { status: 'fail', detail: 'blob hash does NOT match the Rekor entry' };
        });
      })
      .catch(function (e) {
        return { status: 'pending', detail: 'logIndex ' + logIndex + ' — open rekor.sigstore.dev to confirm (' + e.message + ')' };
      });
  }

  function renderCertResult(b) {
    resultsSection.classList.add('visible');
    var cert = b.cert, v = b.verify, rekor = b.rekor;
    renderStep('Certification status', cert.status === 'certified' ? 'pass' : 'fail',
      cert.status + (cert.revoked_reason ? ' — ' + cert.revoked_reason : ''));
    renderStep('Signature',
      v.signature_valid === true ? 'pass' : v.signature_valid === false ? 'fail' : 'pending',
      v.signer_kid ? 'kid ' + truncateHex(v.signer_kid) : '');
    renderStep('Authorized signer',
      v.authorized_signer === true ? 'pass' : v.authorized_signer === false ? 'fail' : 'pending',
      v.authorized_signer === true ? 'on the published roster'
        : (v.authorized_signer_note || 'roster check pending'));
    renderStep('Public Rekor inclusion', rekor.status, rekor.detail);

    var summary = {
      certifies: cert.tenant_id + '/' + cert.profile_name,
      snapshot: cert.snapshot_version,
      package_sha256: cert.package_sha256,
      research_class: cert.research_class,
      models: cert.model_ids,
      replication_floor: cert.replication_floor,
      rekor_log_index: cert.rekor_log_index,
      certified_at: cert.certified_at
    };
    decodedJson.textContent = JSON.stringify(summary, null, 2);
    decodedReceipt.style.display = '';
    var heading = decodedReceipt.querySelector('.decoded-heading');
    if (heading) heading.textContent = 'Certified profile';
    renderErrors(v.errors);
  }

  function b64ToBytes(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function bufToHex(buf) {
    var v = new Uint8Array(buf), s = '';
    for (var i = 0; i < v.length; i++) s += v[i].toString(16).padStart(2, '0');
    return s;
  }

  // ---- Published certifications list (so a human never needs a digest) --------
  // Reads the public registry and renders a click-to-verify list. The digest stays
  // plumbing the page handles — you browse by name, or arrive via a ?cert=/?profile=
  // deep-link from a badge, and it just runs.
  var certListEl = document.getElementById('cert-list');
  var certs = [];

  function loadCertList() {
    if (!certListEl) return;
    certListEl.textContent = 'Loading…';
    fetch(CERT_LIST_URL, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { certifications: [] }; })
      .then(function (d) {
        certs = (d.certifications || []).filter(function (c) { return c.status === 'certified'; });
        renderCertList();
        resolveDeepLink();
      })
      .catch(function () { certListEl.textContent = 'Could not load the published certifications.'; });
  }

  function renderCertList() {
    certListEl.innerHTML = '';
    if (certs.length === 0) {
      certListEl.textContent = 'No certified profiles published yet.';
      return;
    }
    certs.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'cert-row';
      var info = document.createElement('div');
      info.className = 'cert-info';
      var name = document.createElement('span');
      name.className = 'cert-name';
      name.textContent = c.tenant_id + '/' + c.profile_name;
      var meta = document.createElement('span');
      meta.className = 'cert-meta';
      meta.textContent = (c.snapshot_version || '') +
        (c.rekor_log_index != null ? ' · Rekor ' + c.rekor_log_index : ' · un-anchored');
      info.appendChild(name); info.appendChild(meta);
      var vb = document.createElement('button');
      vb.className = 'cert-verify-btn';
      vb.type = 'button';
      vb.textContent = 'Verify ↓';
      vb.addEventListener('click', function () {
        verifyCert(c);
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      row.appendChild(info); row.appendChild(vb);
      certListEl.appendChild(row);
    });
  }

  // A badge links here as ?cert=<digest> (console — has the digest) or
  // ?profile=<tenant>/<name> (dashboard — has the name). Resolve to a cert and run.
  function resolveDeepLink() {
    var params = new URLSearchParams(window.location.search);
    var digest = (params.get('cert') || '').toLowerCase();
    var profile = params.get('profile');
    var match = null;
    if (digest) {
      match = certs.filter(function (c) { return c.package_sha256 === digest; })[0];
    } else if (profile) {
      match = certs.filter(function (c) { return (c.tenant_id + '/' + c.profile_name) === profile; })[0];
    }
    if (match) {
      verifyCert(match);
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (digest) {
      verifyCertificate(digest); // not in the active list (e.g. revoked) — fetch directly
    }
  }

  loadCertList();
})();
