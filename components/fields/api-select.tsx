import { createData, fetchData } from "@/database";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { COLORS } from "./text-field";

interface ISearchableSelectProps<T> {
  value?: T | null;
  onSelect?: (_: T | null) => void;
  labelKey: string;
  valueKey: keyof T;
  tableName: string;
  placeholder?: string;
  hasCreateBtn?: boolean;
  style?: {
    container?: object;
    input?: object;
  };
  pageLimit?: number;
  formik?: any;
  name?: string;
}

function SearchableSelect<T extends Record<string, any>>({
  value,
  onSelect,
  labelKey,
  valueKey,
  tableName,
  placeholder = "Select...",
  style = {},
  pageLimit = 10,
  hasCreateBtn = false,
  formik,
  name
}: ISearchableSelectProps<T>) {
  const { t } = useTranslation();
  const [modalVisible, setModalVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const selectedValue = formik && name ? formik.values[name] : value;
  const setValue = (val: T | null) => {
    if (formik && name) {
      formik.setFieldValue(name, val);
      formik.setFieldTouched(name, true);
    } else if (onSelect) {
      onSelect?.(val);
    }
  };

  useEffect(() => {
    if (!modalVisible) return;
    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const filters = `lower(${labelKey}) LIKE lower('%${query}%')`;
        const result: T[] = await fetchData({
          tableName,
          filters,
          page: 0,
          limit: pageLimit
        });
        setData(result);
        setPage(1);
        setHasMore(result.length === pageLimit);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [query, modalVisible, labelKey, tableName, pageLimit]);

  const loadMore = async () => {
    if (!hasMore || loading) return;

    setLoading(true);
    try {
      const filters = `lower(${labelKey}) LIKE lower('%${query}%')`;
      const result: T[] = await fetchData({
        tableName,
        filters,
        page,
        limit: pageLimit
      });
      setData((prev) => [...prev, ...result]);
      setPage((prev) => prev + 1);
      setHasMore(result.length === pageLimit);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const newItem = (await createData(tableName, {
      [labelKey]: query,
      ...(selectedValue.hasOwnProperty("search_text_lower") && {
        search_text_lower: query.toLowerCase()
      })
    })) as T;

    setValue(newItem);
    closeModal();
  };

  const closeModal = () => {
    setModalVisible(false);
    setQuery("");
    setData([]);
  };
  useEffect(() => {
    if (formik?.values) {
      const error =
        formik && name && formik.touched[name] && formik.errors[name];
      setError(error);
    }
  }, [selectedValue]);
  return (
    <View style={[styles.container, style?.container]}>
      <TouchableOpacity
        style={[styles.input, style?.input, error && styles.errorInput]}
        onPress={() => setModalVisible(true)}
      >
        <Text
          style={{
            color: selectedValue?.[labelKey] ? COLORS.text : COLORS.placeholder
          }}
        >
          {selectedValue?.[labelKey] || placeholder}
        </Text>
      </TouchableOpacity>

      {error && <Text style={styles.error}>{error[labelKey]}</Text>}

      <Modal visible={modalVisible} animationType="slide">
        <View style={styles.modalContainer}>
          <TextInput
            placeholder={placeholder}
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
            placeholderTextColor={COLORS.placeholder}
          />

          <FlatList
            data={data}
            keyExtractor={(item) => String(item[valueKey])}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.item}
                onPress={() => {
                  setValue(item);
                  closeModal();
                }}
              >
                <Text>{item[labelKey]}</Text>
              </TouchableOpacity>
            )}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
          />

          {loading && <ActivityIndicator style={styles.activity} />}

          {!loading &&
            query.length > 2 &&
            data.length === 0 &&
            hasCreateBtn && (
              <TouchableOpacity style={styles.create} onPress={handleCreate}>
                <Text style={{ color: COLORS.white }}>
                  {t("Create")}: {query}
                </Text>
              </TouchableOpacity>
            )}

          <TouchableOpacity style={styles.closeButton} onPress={closeModal}>
            <Text>{t("Close")}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

export default SearchableSelect;

const styles = StyleSheet.create({
  container: { marginBottom: 16, width: "100%" },

  input: {
    backgroundColor: COLORS.input,
    borderRadius: 12,
    padding: 12,
    color: COLORS.text,
    fontSize: 16,
    width: "100%"
  },
  activity: { marginVertical: 20 },
  modalContainer: {
    flex: 1,
    padding: 20,
    backgroundColor: COLORS.white
  },

  searchInput: {
    borderWidth: 1,
    borderColor: COLORS.label,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10
  },

  item: {
    padding: 15,
    borderBottomWidth: 1,
    borderColor: COLORS.background
  },

  create: {
    marginTop: 10,
    backgroundColor: COLORS.accent,
    padding: 12,
    borderRadius: 8,
    alignItems: "center"
  },

  closeButton: {
    marginTop: 15,
    alignItems: "center"
  },

  errorInput: {
    borderColor: COLORS.red
  },
  error: { color: COLORS.red, marginTop: 4, fontSize: 12 }
});
