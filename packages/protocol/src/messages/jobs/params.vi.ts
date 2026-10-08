import type { JobsParamsMessages } from './params.ts';

export const vi: JobsParamsMessages = {
unknownParam: (p) => `Tham số không xác định ${p.key}`, invalidParam: (p) => `Tham số ${p.key} ${p.problem}`, mustBeNonEmptyString: 'phải là chuỗi không rỗng', atMostChars: (p) => `phải có tối đa ${p.max} ký tự`, mustBeIntegerBetween: (p) => `phải là số nguyên từ ${p.min} đến ${p.max}`, mustBeOneOf: (p) => `phải là một trong ${p.values}`, mustBeArray: 'phải là mảng', atLeastItems: (p) => `phải có ít nhất ${p.min} mục`, atMostItems: (p) => `phải có tối đa ${p.max} mục`, mustBeBoolean: 'phải là true hoặc false', mustBeLanguageTag: 'phải là thẻ ngôn ngữ BCP 47', mustBeAbsolutePath: 'phải là đường dẫn tuyệt đối', itemsMustBeAbsolutePaths: 'chỉ được chứa đường dẫn tuyệt đối', onlyOneOf: (p) => `không thể kết hợp với ${p.other}`, createExcludesVideoId: 'tạo video mới và không thể kết hợp với videoId', targetShape: 'phải là { videoId }, { entryId } hoặc { create }',
};
