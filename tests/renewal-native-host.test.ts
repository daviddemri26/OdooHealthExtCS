import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachRenewalButtonHost,
  findNativeRenewButton,
  NATIVE_RENEW_BUTTON_SELECTOR,
} from '../src/features/renewals/native-host';

function makeVisible(button: HTMLButtonElement, width = 82, height = 34): void {
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    width,
    height,
    toJSON: () => ({}),
  });
}

describe('native Renew split-button host', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('uses the technical button name and inserts an isolated sibling host', () => {
    document.body.innerHTML = `
      <div class="o_form_view"><div class="actions">
        <button
          name="prepare_renewal_order"
          type="object"
          style="margin-inline-end: 6px; border-top-right-radius: 7px; border-bottom-right-radius: 7px"
        >Renouveler</button>
      </div></div>`;
    const button = document.querySelector<HTMLButtonElement>(NATIVE_RENEW_BUTTON_SELECTOR)!;
    makeVisible(button);

    expect(findNativeRenewButton()).toBe(button);
    const attached = attachRenewalButtonHost('renewal-host', '.renewal-caret { color: red; }');
    expect(attached?.sourceButton).toBe(button);
    expect(button.nextElementSibling).toBe(attached?.host);
    expect(attached?.shadow.querySelector('style')).toHaveTextContent('color: red');
    expect(attached?.shadow.querySelector('style')).toHaveTextContent('ohe-renewal-caret-expand');
    expect(attached?.shadow.querySelector('style')).toHaveTextContent('inline-size: 0');
    expect(attached?.shadow.querySelector('style')).not.toHaveTextContent('opacity: 0');
    expect(attached?.shadow.querySelector('style')).not.toHaveTextContent('brightness');
    expect(attached?.shadow.querySelector('style')).toHaveTextContent(
      '--renew-button-hover-background',
    );
    expect(attached?.shadow.querySelector('style')).toHaveTextContent(
      '--renew-button-active-background',
    );
    expect(attached?.shadow.querySelector('style')).not.toHaveTextContent("[aria-expanded='true']");
    expect(attached?.shadow.querySelector('style')).toHaveTextContent(
      '.ohe-renewal-caret-button::before',
    );
    expect(attached?.shadow.querySelector('style')).toHaveTextContent(
      'background: var(--renew-button-separator-color, currentColor)',
    );
    expect(attached?.shadow.querySelector('style')).toHaveTextContent('opacity: .42');
    expect(attached?.shadow.querySelector('style')).toHaveTextContent('isolation: isolate');
    expect(attached?.shadow.querySelector('style')).toHaveTextContent(
      'background-clip: padding-box',
    );
    expect(attached?.shadow.querySelector('style')).toHaveTextContent('prefers-reduced-motion');
    expect(attached?.container.parentNode).toBe(attached?.shadow);
    expect(attached?.host.style.width).toBe('');
    expect(attached?.host.style.minWidth).toBe('0px');
    expect(attached?.host.style.overflow).toBe('hidden');
    expect(attached?.host.style.marginInlineStart).toBe('0px');
    expect(attached?.host.style.getPropertyPriority('margin-inline-start')).toBe('important');
    expect(attached?.host.style.marginInlineEnd).toBe('6px');
    expect(attached?.container.style.flex).toBe('0 0 var(--renew-button-caret-width, 32px)');
    expect(button.style.getPropertyValue('border-top-right-radius')).toBe('0px');
    expect(button.style.getPropertyPriority('border-top-right-radius')).toBe('important');
    expect(button.style.getPropertyValue('border-bottom-right-radius')).toBe('0px');
    expect(button.style.getPropertyValue('border-right-width')).toBe('0px');
    expect(button.style.getPropertyValue('margin-inline-end')).toBe('0px');
    expect(button).toHaveAttribute('data-ohe-renewal-split-source', 'true');

    attached?.detach();
    expect(document.getElementById('renewal-host')).toBeNull();
    expect(button.style.getPropertyValue('border-top-right-radius')).toBe('7px');
    expect(button.style.getPropertyValue('border-bottom-right-radius')).toBe('7px');
    expect(button.style.getPropertyValue('border-right-width')).toBe('');
    expect(button.style.getPropertyValue('margin-inline-end')).toBe('6px');
    expect(button).not.toHaveAttribute('data-ohe-renewal-split-source');
  });

  it('cancels only the parent gap at the Renew/caret seam', () => {
    document.body.innerHTML = `
      <div class="o_form_view"><div class="actions" style="display: flex; flex-direction: row; column-gap: 6px">
        <button
          name="prepare_renewal_order"
          type="object"
          style="margin-inline-end: 4px"
        >Renew</button>
        <button type="button">Next action</button>
      </div></div>`;
    const button = document.querySelector<HTMLButtonElement>(NATIVE_RENEW_BUTTON_SELECTOR)!;
    makeVisible(button);

    const attached = attachRenewalButtonHost('renewal-host', '');

    // The negative start margin neutralizes the parent's six-pixel gap only
    // between Renew and the caret. The native end margin remains on the host,
    // while the parent still applies its normal gap before the next action.
    expect(attached?.host.style.marginInlineStart).toBe('-6px');
    expect(attached?.host.style.getPropertyPriority('margin-inline-start')).toBe('important');
    expect(attached?.host.style.marginInlineEnd).toBe('4px');
    expect(attached?.host.nextElementSibling).toHaveTextContent('Next action');
    expect(attached?.host.parentElement).toHaveStyle({ columnGap: '6px' });

    attached?.detach();
    expect(button.style.marginInlineEnd).toBe('4px');
  });

  it('restores the original native button before replacing an existing host', () => {
    document.body.innerHTML = `
      <div class="o_form_view"><div class="actions">
        <button
          name="prepare_renewal_order"
          type="object"
          style="border-top-right-radius: 9px; border-bottom-right-radius: 9px"
        >Renew</button>
      </div></div>`;
    const button = document.querySelector<HTMLButtonElement>(NATIVE_RENEW_BUTTON_SELECTOR)!;
    makeVisible(button);

    const first = attachRenewalButtonHost('renewal-host', '');
    const second = attachRenewalButtonHost('renewal-host', '');

    expect(first?.host.isConnected).toBe(false);
    expect(second?.host.isConnected).toBe(true);
    expect(button.style.getPropertyValue('border-top-right-radius')).toBe('0px');
    second?.detach();
    expect(button.style.getPropertyValue('border-top-right-radius')).toBe('9px');
    expect(button.style.getPropertyValue('border-bottom-right-radius')).toBe('9px');
  });

  it('recovers an orphan host before capturing a fresh native style snapshot', () => {
    document.body.innerHTML = `
      <div class="o_form_view"><div class="actions">
        <button
          name="prepare_renewal_order"
          type="object"
          style="margin-inline-end: 6px; border-top-right-radius: 9px; border-bottom-right-radius: 8px"
        >Renew</button>
      </div></div>`;
    const button = document.querySelector<HTMLButtonElement>(NATIVE_RENEW_BUTTON_SELECTOR)!;
    makeVisible(button);

    const first = attachRenewalButtonHost('renewal-host', '');
    const orphan = first!.host.cloneNode(true) as HTMLSpanElement;
    first!.host.replaceWith(orphan);

    expect(button.style.getPropertyValue('border-top-right-radius')).toBe('0px');
    expect(button).toHaveAttribute('data-ohe-renewal-split-snapshot');

    const replacement = attachRenewalButtonHost('renewal-host', '');
    expect(orphan.isConnected).toBe(false);
    expect(replacement?.host.isConnected).toBe(true);
    expect(button.style.getPropertyValue('border-top-right-radius')).toBe('0px');

    replacement?.detach();
    expect(button.style.getPropertyValue('border-top-right-radius')).toBe('9px');
    expect(button.style.getPropertyValue('border-bottom-right-radius')).toBe('8px');
    expect(button.style.getPropertyValue('margin-inline-end')).toBe('6px');
    expect(button).not.toHaveAttribute('data-ohe-renewal-split-source');
    expect(button).not.toHaveAttribute('data-ohe-renewal-split-snapshot');
  });

  it('repairs a legacy orphan without snapshot from the mirrored host values', () => {
    document.body.innerHTML = `
      <div class="o_form_view"><div class="actions">
        <button
          name="prepare_renewal_order"
          type="object"
          data-ohe-renewal-split-source="true"
          style="margin-inline-end: 0px !important; border-top-right-radius: 0px !important; border-bottom-right-radius: 0px !important; border-right-width: 0px !important"
        >Renew</button>
        <span
          id="renewal-host"
          style="margin-inline-end: 5px; --renew-button-radius-top-right: 7px; --renew-button-radius-bottom-right: 6px"
        ></span>
      </div></div>`;
    const button = document.querySelector<HTMLButtonElement>(NATIVE_RENEW_BUTTON_SELECTOR)!;
    makeVisible(button);

    const replacement = attachRenewalButtonHost('renewal-host', '');
    expect(replacement?.host.isConnected).toBe(true);
    expect(button.style.getPropertyValue('border-top-right-radius')).toBe('0px');

    replacement?.detach();
    expect(button.style.getPropertyValue('border-top-right-radius')).toBe('7px');
    expect(button.style.getPropertyValue('border-bottom-right-radius')).toBe('6px');
    expect(button.style.getPropertyValue('border-right-width')).toBe('');
    expect(button.style.getPropertyValue('margin-inline-end')).toBe('5px');
    expect(button).not.toHaveAttribute('data-ohe-renewal-split-source');
  });

  it.each([
    {
      background: 'rgb(244, 245, 247)',
      color: 'rgb(33, 37, 41)',
      hoverBackground: 'rgb(232, 233, 235)',
      hoverColor: 'rgb(22, 25, 28)',
      activeBackground: 'rgb(218, 219, 221)',
      activeColor: 'rgb(11, 13, 15)',
    },
    {
      background: 'rgb(54, 58, 69)',
      color: 'rgb(238, 238, 238)',
      hoverBackground: 'rgb(66, 70, 82)',
      hoverColor: 'rgb(255, 255, 255)',
      activeBackground: 'rgb(43, 47, 57)',
      activeColor: 'rgb(248, 248, 248)',
    },
  ])(
    'mirrors native $background button colors and state tokens in either theme',
    ({ background, color, hoverBackground, hoverColor, activeBackground, activeColor }) => {
      document.body.innerHTML = `
      <div class="o_form_view"><div class="actions">
        <button
          name="prepare_renewal_order"
          type="object"
          style="
            background: ${background};
            color: ${color};
            border-color: ${color};
            --bs-btn-hover-bg: ${hoverBackground};
            --bs-btn-hover-color: ${hoverColor};
            --bs-btn-hover-border-color: ${hoverColor};
            --bs-btn-active-bg: ${activeBackground};
            --bs-btn-active-color: ${activeColor};
            --bs-btn-active-border-color: ${activeColor}
          "
        >Renew</button>
      </div></div>`;
      const button = document.querySelector<HTMLButtonElement>(NATIVE_RENEW_BUTTON_SELECTOR)!;
      makeVisible(button);

      const attached = attachRenewalButtonHost('renewal-host', '');

      expect(attached?.host.style.getPropertyValue('--renew-button-background')).toContain(
        background,
      );
      expect(attached?.host.style.getPropertyValue('--renew-button-color')).toBe(color);
      expect(attached?.host.style.getPropertyValue('--renew-button-border-color')).toBe(color);
      expect(attached?.host.style.getPropertyValue('--renew-button-separator-color')).toBe(color);
      expect(attached?.host.style.getPropertyValue('--renew-button-hover-background')).toBe(
        hoverBackground,
      );
      expect(attached?.host.style.getPropertyValue('--renew-button-hover-color')).toBe(hoverColor);
      expect(attached?.host.style.getPropertyValue('--renew-button-hover-border-color')).toBe(
        hoverColor,
      );
      expect(attached?.host.style.getPropertyValue('--renew-button-active-background')).toBe(
        activeBackground,
      );
      expect(attached?.host.style.getPropertyValue('--renew-button-active-color')).toBe(
        activeColor,
      );
      expect(attached?.host.style.getPropertyValue('--renew-button-active-border-color')).toBe(
        activeColor,
      );
    },
  );

  it('lightens the caret on hover when Odoo exposes no explicit hover token', () => {
    document.body.innerHTML = `
      <div class="o_form_view"><div class="actions">
        <button
          name="prepare_renewal_order"
          type="object"
          style="background: rgb(54, 58, 69); color: rgb(238, 238, 238); border-color: rgb(80, 84, 95)"
        >Renew</button>
      </div></div>`;
    const button = document.querySelector<HTMLButtonElement>(NATIVE_RENEW_BUTTON_SELECTOR)!;
    makeVisible(button);

    const attached = attachRenewalButtonHost('renewal-host', '');

    expect(attached?.host.style.getPropertyValue('--renew-button-hover-background')).toContain(
      'rgb(54, 58, 69)',
    );
    expect(attached?.host.style.getPropertyValue('--renew-button-hover-filter')).toBe(
      'brightness(1.12)',
    );
  });

  it('keeps a visible foreground separator when the native border is transparent', () => {
    document.body.innerHTML = `
      <div class="o_form_view"><div class="actions">
        <button
          name="prepare_renewal_order"
          type="object"
          style="background: rgb(54, 58, 69); color: rgb(238, 238, 238); border-color: transparent"
        >Renew</button>
      </div></div>`;
    const button = document.querySelector<HTMLButtonElement>(NATIVE_RENEW_BUTTON_SELECTOR)!;
    makeVisible(button);

    const attached = attachRenewalButtonHost('renewal-host', '');

    expect(attached?.host.style.getPropertyValue('--renew-button-border-color')).toBe(
      'rgba(0, 0, 0, 0)',
    );
    expect(attached?.host.style.getPropertyValue('--renew-button-separator-color')).toBe(
      'rgb(238, 238, 238)',
    );
  });

  it('keeps mirrored hover and active visuals stable across repeated pointer events', () => {
    document.body.innerHTML = `
      <div class="o_form_view"><div class="actions">
        <button
          name="prepare_renewal_order"
          type="object"
          style="
            background: rgb(54, 58, 69);
            color: rgb(238, 238, 238);
            border-color: rgb(80, 84, 95);
            --bs-btn-hover-bg: rgb(66, 70, 82);
            --bs-btn-active-bg: rgb(43, 47, 57)
          "
        >Renew</button>
      </div></div>`;
    const button = document.querySelector<HTMLButtonElement>(NATIVE_RENEW_BUTTON_SELECTOR)!;
    makeVisible(button);
    const attached = attachRenewalButtonHost('renewal-host', '');
    const initialHover = attached?.host.style.getPropertyValue('--renew-button-hover-background');
    const initialActive = attached?.host.style.getPropertyValue('--renew-button-active-background');

    for (let index = 0; index < 3; index += 1) {
      button.style.background = `rgb(${80 + index}, ${84 + index}, ${95 + index})`;
      button.dispatchEvent(new Event('pointerenter'));
      button.dispatchEvent(new Event('pointerleave'));
      button.dispatchEvent(new Event('pointerdown'));
      button.dispatchEvent(new Event('pointerup'));
    }

    expect(attached?.host.style.getPropertyValue('--renew-button-hover-background')).toBe(
      initialHover,
    );
    expect(attached?.host.style.getPropertyValue('--renew-button-active-background')).toBe(
      initialActive,
    );
  });

  it('fails closed for translated-text lookalikes, hidden buttons, or ambiguity', () => {
    document.body.innerHTML = `
      <div class="o_form_view">
        <button name="unrelated" type="object">Renew</button>
        <button name="prepare_renewal_order" type="object" hidden>Renew</button>
      </div>`;
    expect(findNativeRenewButton()).toBeNull();
    expect(attachRenewalButtonHost('renewal-host', '')).toBeNull();

    document.body.innerHTML = `
      <div class="o_form_view">
        <button name="prepare_renewal_order" type="object">Renew</button>
        <button name="prepare_renewal_order" type="object">Renew</button>
      </div>`;
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    buttons.forEach((button) => makeVisible(button));
    expect(findNativeRenewButton()).toBeNull();
  });
});
