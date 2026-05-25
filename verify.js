/* verify.js — AuspexAI receipt verifier (vanilla ES6, no imports)
   Calls the coordinator's /api/v0/receipts/verify endpoint and renders results.

   CORS note: coord.auspexai.network allows requests from auspexai.network.
   This will NOT work from file:// origins — use a local HTTP server or deploy. */

(function () {
  'use strict';

  var VERIFY_URL = 'https://coord.auspexai.network/api/v0/receipts/verify';

  var textarea = document.getElementById('receipt-input');
  var btn = document.getElementById('verify-btn');
  var resultsSection = document.getElementById('verify-results');
  var stepsContainer = document.getElementById('verify-steps');
  var decodedReceipt = document.getElementById('decoded-receipt');
  var decodedJson = document.getElementById('decoded-json');
  var errorsContainer = document.getElementById('verify-errors');
  var errorList = document.getElementById('error-list');

  btn.addEventListener('click', function () {
    var raw = textarea.value.replace(/\s+/g, '');
    if (!raw) {
      textarea.focus();
      return;
    }
    runVerification(raw);
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
              if (parsed.detail) msg += ': ' + parsed.detail;
              else if (parsed.error) msg += ': ' + parsed.error;
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
      // null / undefined — coordinator returns null for this currently
      authStatus = 'pending';
      authDetail = 'verification pending';
    }
    renderStep('Authorized Signer', authStatus, authDetail);

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
})();
