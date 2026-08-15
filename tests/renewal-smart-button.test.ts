import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NATIVE_RENEWAL_QUOTE_BUTTON_SELECTOR,
  NATIVE_RENEWAL_QUOTE_VALUE_SELECTOR,
  RenewalQuoteSmartButtonManager,
} from '../src/features/renewals/smart-button';

function buttonBox(nativeRenewalCount?: number): void {
  document.body.innerHTML = `
    <div class="o_form_view">
      <div class="o-form-buttonbox d-flex">
        <button name="action_view_invoice" class="btn oe_stat_button btn-outline-secondary">Invoices</button>
        ${
          nativeRenewalCount === undefined
            ? ''
            : `<button name="open_subscription_renewal" type="object" class="btn oe_stat_button btn-outline-secondary flex-grow-1 flex-lg-grow-0">
                <i class="o_button_icon fa fa-fw fa-repeat"></i>
                <div name="renewal_count" class="o_field_widget o_readonly_modifier o_field_statinfo">
                  <span class="o_stat_info o_stat_value">${nativeRenewalCount}</span>
                  <span class="o_stat_text">Renewal Quote</span>
                </div>
              </button>`
        }
        <button name="open_subscription_history" class="btn oe_stat_button btn-outline-secondary">Sales History</button>
      </div>
    </div>`;
}

function state(count: number, sourceOrderId = 42) {
  return { enabled: true, sourceOrderId, visibleRenewalQuoteCount: count };
}

describe('dynamic Renewal Quote smart button count', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('updates only the native count and preserves its click handler and markup', () => {
    buttonBox(3);
    const nativeButton = document.querySelector<HTMLButtonElement>(
      NATIVE_RENEWAL_QUOTE_BUTTON_SELECTOR,
    )!;
    const nativeMarkup = nativeButton.innerHTML;
    const nativeClick = vi.fn();
    nativeButton.addEventListener('click', nativeClick);
    const manager = new RenewalQuoteSmartButtonManager({ document });

    manager.sync(state(5));

    expect(nativeButton.querySelector(NATIVE_RENEWAL_QUOTE_VALUE_SELECTOR)).toHaveTextContent('5');
    expect(nativeButton.innerHTML.replace('>5<', '>3<')).toBe(nativeMarkup);
    nativeButton.click();
    expect(nativeClick).toHaveBeenCalledTimes(1);

    manager.detach();
    expect(nativeButton.querySelector(NATIVE_RENEWAL_QUOTE_VALUE_SELECTOR)).toHaveTextContent('3');
  });

  it('uses the newest value between an Odoo rerender and the controlled count', () => {
    buttonBox(7);
    const manager = new RenewalQuoteSmartButtonManager({ document });

    manager.sync(state(5));
    expect(document.querySelector(NATIVE_RENEWAL_QUOTE_VALUE_SELECTOR)).toHaveTextContent('7');

    const value = document.querySelector<HTMLElement>(NATIVE_RENEWAL_QUOTE_VALUE_SELECTOR)!;
    value.textContent = '9';
    manager.sync(state(8));
    expect(value).toHaveTextContent('9');
  });

  it('does nothing when Odoo has no native Renewal Quote button', () => {
    buttonBox();
    const originalMarkup = document.body.innerHTML;
    const manager = new RenewalQuoteSmartButtonManager({ document });

    manager.sync(state(0));
    manager.sync(state(3));

    expect(document.body.innerHTML).toBe(originalMarkup);
    expect(document.querySelector(NATIVE_RENEWAL_QUOTE_BUTTON_SELECTOR)).toBeNull();
  });

  it('resets the native-count baseline when the subscription changes', () => {
    buttonBox(9);
    const manager = new RenewalQuoteSmartButtonManager({ document });
    manager.sync(state(10, 42));

    buttonBox(1);
    manager.sync(state(2, 43));

    expect(document.querySelector(NATIVE_RENEWAL_QUOTE_VALUE_SELECTOR)).toHaveTextContent('2');
  });
});
